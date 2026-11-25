# FSS@UNIDEL Electronic Voting System

A faculty-wide platform for managing student registration, candidate nominations, nomination payments, elections, voting, moderation and results for the Faculty of the Social Sciences, University of Delta, Agbor (UNIDEL).

## Project status

**Implementation in progress; not production-ready.** The repository contains a Node.js/Express application, PostgreSQL migrations, student registration/login/password-reset flows, administration tools, nominations and manual payment review, election lifecycle controls, secret-ballot submission, voter eligibility administration and aggregate participation reporting. Termii SMS adapter is implemented but not yet connected to a live Termii account; no production database, payment integration, hosting or live election is configured. Automated PostgreSQL integration tests run in GitHub Actions; independent security review, live Termii verification and a supervised mock election remain outstanding.

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
- Use HTTPS, secure session handling, rate limits, same-origin checks on state-changing requests, input validation and least-privilege database access. In production behind a TLS-terminating reverse proxy, configure `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops (default 1).
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

### Automated mock-election integration test

The CI workflow starts a disposable PostgreSQL 16 service, applies all numbered migrations, and runs a full mock election through the HTTP API. The test covers:
- Student self-registration and duplicate matriculation-number rejection.
- Administrator login and election/office creation.
- Candidate nomination, manual payment verification and eligibility approval.
- Individual voter exclusion before voting opens.
- Nomination closure and the UNOPPOSED flag.
- Ballot access restrictions, one-time authorisation and accepted ballot submission.
- Duplicate-vote prevention, aggregate turnout, unpublished-results protection and results publication.
- Database-level rejection of cross-election ballot references.
- Confirmation that ballot and ballot-selection tables do not contain voter identity columns.

The integration test is deliberately destructive to its database and refuses to run unless the database name ends in `_test`. CI uses a dedicated `fss_voting_test` database. To run locally, create a disposable test database with a name ending in `_test`, set `DATABASE_URL`, `SESSION_SECRET` and `OTP_PEPPER`, then run:

```bash
npm install
npm run db:migrate
npm run check
npm test
```

When `DATABASE_URL` is not set, Node's test runner skips the database integration test. A successful CI run is a development check, not a substitute for independent security review, load testing or a supervised mock election.

### Important limitations at this stage
- The application workflows and browser interfaces are implemented in the repository, but no public production website or election is deployed.
- Termii is the selected SMS provider for password-reset OTPs. The adapter sends a transactional SMS through Termii's DND route to the registered phone number (E.164 is converted to digits-only international format). The API key and sender ID must be configured as server environment secrets; the sender ID must be approved, and Termii must activate DND/transactional messaging on the account. Until those account steps are complete, SMS delivery remains unavailable. The registrant's saved phone number remains the only OTP destination.
- Numbered migrations create the core schema, nomination/payment structures, voting authorisations, cross-election ballot integrity constraints, election-specific voter eligibility, voter snapshots, append-only audit logs, election lifecycle guards, ballot immutability, unique payment references and database-enforced nomination/payment history protections. The SQL has not yet been applied to a live production database.
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



### Termii SMS setup

The Termii adapter uses the official `POST /api/sms/send` messaging endpoint and the DND route for transactional OTPs. Termii assigns an account-specific API base URL; copy the exact HTTPS base URL shown in the institution's Termii dashboard rather than assuming a generic regional URL. See the [Termii API endpoint guidance](https://developer.termii.com/) and [Messaging API documentation](https://developer.termii.com/messaging-api).

Configure these server environment variables (never commit real values):

```env
SMS_PROVIDER=termii
TERMII_API_KEY=your_private_termii_api_key
TERMII_SENDER_ID=your_DND_approved_sender_id
TERMII_BASE_URL=the_exact_HTTPS_base_URL_from_your_Termii_dashboard
```

Before enabling password-reset SMS:
1. Create or access the institution's Termii account and obtain its API key.
2. Ask Termii which sender ID is enabled for the DND route on the institutional account. Configure that exact sender ID; a generic/alphanumeric sender approval does not by itself prove DND-route availability.
3. Ask Termii support (support@termii.com) to activate the DND route for transactional OTP messages; the generic route is not suitable for OTPs.
4. Copy the account-specific HTTPS base URL from the Termii dashboard and add all environment variables to the server's secret configuration, then restart/redeploy the application.
5. Run a controlled password-reset test using an authorised test account and phone number, then confirm delivery and successful one-time code use.

The repository tests the adapter using mocked HTTP responses. A successful automated test does not prove that the live account, sender ID, DND route, credits or mobile-network delivery are configured.

## Candidate nomination and payment workflow

- Election administrators can create draft elections and configure offices, seat counts and nomination fees.
- Nominations can be opened only after at least one office is configured.
- Signed-in students can view open nomination opportunities, submit one nomination per office/election and provide their payment channel and transaction reference.
- Nomination records receive unique references. Candidates can download an individual PDF nomination form for each submitted nomination.
- Finance administrators can configure payment account instructions and review pending payment records. Payment verification is separate from eligibility approval.
- The initial workflow records transaction references for manual verification; it does not yet accept receipt uploads or connect to bank/payment APIs.
- Run `npm run db:migrate` to apply numbered SQL migrations. Applied migrations are tracked in `schema_migrations`.


### Candidate eligibility review

Payment verification and candidate eligibility are deliberately separate administrative decisions. A nomination remains pending until reviewed. The election administrator can approve or reject eligibility; approval is blocked unless the associated nomination payment has first been verified. Both decisions are recorded in the audit log.


## Secret ballot voting

The voting module separates voter participation from ballot selections. Students authenticate with their registered accounts and request a short-lived, single-use voting authorisation. The server stores only a hash of that authorisation alongside the voter identity. On submission, the server validates the authorisation and eligibility, writes the anonymous ballot and the voter participation record in the same database transaction, and consumes the authorisation. The ballot and selection tables contain no student/user identifier. However, ballot and participation records retain timestamps, so a privileged operator with database access may be able to infer correlations from timing and other operational data.

The database enforces one participation record per student per election and composite foreign-key constraints tying every ballot selection to an office and nomination in the same election. Active accounts are eligible by default unless an election administrator records an exclusion for that election. Eligibility changes are locked once voting opens. Ballot submission validates approved nominations and seat limits. Ballot selections cannot be edited through the application. Administrators can view aggregate turnout overall and by department without access to individual ballot choices.

Election administrators must close nominations before scheduling voting. Every office must have at least one approved candidate. Voting can be closed by an authorised administrator, and results can only be published after closure. Published results show candidate vote totals and overall participation.

**Privacy qualification:** This design prevents ordinary application administrators from looking up a student's choices through the application data model. It is not a cryptographic end-to-end secret-ballot protocol against a fully privileged database operator, server operator, collusion, or external coercion. Production deployment should use tightly restricted database access, independent security review, backups and monitoring.

## Deployment preparation

A production Dockerfile and deployment runbook are provided in `Dockerfile` and `docs/DEPLOYMENT.md`. The application is not yet deployed: it still requires a selected hosting provider, a production PostgreSQL database, HTTPS/domain configuration, server secrets, Termii account activation for SMS password resets, and one-time super-administrator bootstrap. Do not treat the GitHub repository or passing CI as a live election service.

## Build checks

Run `npm run check` to syntax-check the application modules and browser script. Run `npm test` for automated tests. The project still requires a configured PostgreSQL database and deployment environment before it can be exercised end-to-end.
