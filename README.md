# FSS@UNIDEL Electronic Voting System

A faculty-wide platform for managing student registration, candidate nominations, nomination payments, elections, voting, moderation and results for the Faculty of the Social Sciences, University of Delta, Agbor (UNIDEL).

## Project status

**Early implementation stage.** The repository now contains a Node.js/Express backend foundation, PostgreSQL schema, student authentication API, protected administrator API and a responsive student portal. No production database, SMS gateway, payment processing, live election or voting service is deployed.

## Agreed functional requirements

### Student accounts
- Students self-register through a public registration link.
- Registration fields: full name, sex, department, level, matriculation number (or registration number for 100 Level), phone number and a password.
- No OTP is required during registration or ordinary login.
- Matriculation/registration number and phone number must each be unique.
- Passwords must be stored using a modern adaptive password hash; plaintext passwords must never be stored or visible to administrators.
- OTP is required only for password reset, sent to the phone number already registered to that account.
- Phone-number changes require an administrator-controlled recovery process.
- Registration does not depend on an uploaded Faculty Excel register. Administrators can review, suspend or reject questionable accounts before an election opens.

### Candidate nominations and fees
- A registered student can submit one or more nominations where election rules permit.
- Each candidate/office nomination is a separate record with its own unique nomination reference and downloadable nomination form.
- Form fields include nominee name, department, matriculation/registration number and office nominated for.
- Administrators configure nomination fees and payment instructions, including bank/payment provider, account name, account number and other instructions.
- Initial payment workflow is manual: candidate submits a transfer reference and/or receipt; an authorised administrator verifies it.
- Payment verification and candidate eligibility/nomination approval are separate decisions.
- Duplicate nominations for the same candidate, office and election are blocked.

### Elections and ballots
- Administrators create elections, offices, nomination windows, voting windows and eligible voter rules.
- Only approved candidates appear on the relevant ballot.
- Enforce one accepted ballot per eligible student per election (or per ballot, as configured).
- Results remain hidden until an authorised publication action.
- A submitted vote cannot be edited or deleted by administrators.
- Voter identity and ballot selections should be separated in the data design so administrators cannot casually inspect how an individual voted.
- Election audit events must not contain ballot selections or compromise ballot secrecy.

### Moderation and administration
- Authorised administrators can mute, suspend, deactivate/remove and restore accounts.
- Muting restricts discussion/posting privileges only; it does not by itself block account access or voting.
- Suspension blocks account access and voting for the suspension period.
- Deactivation removes platform access without erasing legally/operationally required election and audit records.
- Moderation actions require a reason and are recorded with actor and timestamp.
- Admin functions include user search/filter, election setup, office setup, fee/payment settings, payment verification, nomination review, voter-list review and results publication.
- Privileged actions are role-restricted and audited.

## Security and deployment principles
- All authoritative validation and election actions must run on a trusted server, never only in browser JavaScript.
- Use HTTPS, secure session handling, rate limits, CSRF protection where applicable, input validation and least-privilege database access.
- Use parameterised database queries and protect secrets in deployment environment variables; never commit credentials, API keys, OTP secrets or production data.
- Password reset OTPs must be short-lived, single-use, rate-limited and stored only as secure verifiers.
- Preserve append-only audit records for sensitive administrative actions.
- Back up the database and test restoration before an election.
- Conduct independent security and election-procedure testing before using the system for a binding election.

## Proposed delivery sequence
1. Requirements and repository foundation.
2. Database schema, server configuration and secure authentication.
3. Student registration, login and password-reset OTP.
4. Admin dashboard, account moderation and election configuration.
5. Candidate nomination, manual payment verification and PDF nomination forms.
6. Ballot, vote integrity, results and audit reporting.
7. Testing, deployment configuration and operational handover.

## Institutional identity
- Faculty: Faculty of the Social Sciences
- Institution: University of Delta, Agbor (UNIDEL)
- Faculty contact: fss@unidel.edu.ng
- Motto/tagline context: R.A.I.S.E UNIDEL through S.O.C.I.A.L

## Important implementation note
Department and programme options must be configurable by administrators and reconciled with the Faculty's approved structure. Peace and Conflict Studies is a programme under Sociology, not a separate department; Public Administration is not part of this Faculty.

## Backend foundation (implementation started)

The first backend foundation has been committed to `main`.

### Current implementation
- Node.js 20+ / Express API scaffold.
- PostgreSQL initial migration for accounts, profiles, roles, elections, offices, nominations, nomination payments, participation, anonymous ballots, ballot selections, moderation and audit records.
- Student registration and password login API.
- Argon2id password hashing; passwords are never returned by the API.
- Unique matriculation/registration number and phone constraints.
- Password-reset endpoints designed to send a short-lived OTP only to the phone number already stored for the account.
- PostgreSQL-backed sessions and baseline request rate limits.

### API routes currently present
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/password-reset/request`
- `POST /api/auth/password-reset/complete`

### Local setup
1. Install Node.js 20 or later and PostgreSQL.
2. Clone this repository and run `npm install`.
3. Create a PostgreSQL database.
4. Copy `.env.example` to `.env` and set `DATABASE_URL`, `SESSION_SECRET` and `OTP_PEPPER` to private values.
5. Run `npm run db:migrate`.
6. Run `npm run dev` and check `http://localhost:3000/api/health`.

### Important limitations at this stage
- This is a backend foundation, not a finished voting website. No public registration page, admin dashboard, nomination form, payment processing, ballot interface or deployment is live yet.
- SMS delivery is intentionally disabled until a specific gateway is selected and its adapter is implemented and tested. The registrant's saved phone number is the intended OTP destination; it is not itself the SMS delivery provider.
- The initial migration creates the core data structures. Election workflows, authorisation policies, ballot submission transactions, independent security tests and deployment hardening still need to be implemented before an actual election.
- The public repository must contain no real student records, passwords, API keys, OTPs, receipts or production database credentials.


## Administrator foundation

- Admin API routes are protected by server-side role checks.
- The first `super_admin` is assigned only through a one-time command against an existing registered account. It cannot be self-assigned through a public endpoint.
- The bootstrap command refuses to run if any admin role already exists.
- Student search returns masked phone numbers and supports name, matriculation number, department, level and account-status filters.
- Moderation actions are reasoned and audited: mute, suspend, deactivate and restore.
- Muting is stored as a time-limited flag; discussion/comment endpoints must enforce it when those features are introduced. Muting does not block sign-in or voting.
- Suspension and deactivation prevent sign-in. Existing election records are retained.

### First administrator setup (after deploying the database and registering the intended account)

Set the temporary environment variable `ADMIN_BOOTSTRAP_CONFIRM=I_HAVE_SECURED_DATABASE_ACCESS`, then run:

```bash
npm run admin:bootstrap -- MATRIC_OR_REGISTRATION_NUMBER
```

Confirm with `YES` at the prompt. Remove the temporary environment variable after the command completes. This command requires direct access to the trusted server/database environment; never run it from a public browser or commit the confirmation value.


## Student portal interface

A responsive web interface is now served from the application root (`/`).

- Student registration form with required student details and password confirmation.
- Registration OTP is not requested.
- Student sign-in uses the matriculation/registration number and password.
- Password recovery guides the student through requesting an SMS code and submitting the code with a new password. The server sends only to the saved account phone number when a configured SMS adapter is available.
- Authenticated student dashboard displays the student's name, student number, department and level.
- Restricted administrator panel supports account search and moderation actions through the protected admin API.
- Frontend assets are served locally; no third-party JavaScript or CSS CDN is used.

The department choices in the initial form are a starter list and must be checked against the Faculty's approved current structure before public launch.
