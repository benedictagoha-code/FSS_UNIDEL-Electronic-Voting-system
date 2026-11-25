# Technical Architecture (Proposed)

## Purpose
This document records the proposed implementation architecture for the FSS@UNIDEL Electronic Voting System. It is a planning baseline, not evidence that a production service has been deployed.

## Proposed stack
- Application runtime: supported Node.js LTS release.
- Server: Express with server-side validation and role-protected routes.
- Database: PostgreSQL.
- Frontend: responsive HTML, CSS and JavaScript served by the application.
- Password hashing: Argon2id (or another currently recommended adaptive password hash).
- SMS: an SMS provider selected for Nigeria, used only for password-reset OTP delivery.
- Nomination forms: server-generated PDF files.
- Hosting: to be selected after reviewing institutional requirements, data residency, backups, HTTPS, availability and operational cost.

## Application boundaries
1. Public pages: election information, registration and login.
2. Student area: profile, nominations, payment submissions and nomination-form downloads.
3. Administration area: users, moderation, election setup, offices, fees, payment verification, nominations, publication and audit review.
4. Voting service: eligibility checks, ballot issuance, one accepted ballot per configured voter/election, and secret-ballot storage.
5. Background services: expiry of reset codes, rate-limit housekeeping and scheduled operational checks.

## Data design principles
- Use database constraints for unique student identifiers, unique registered phone numbers, and duplicate nomination prevention.
- Keep authentication/account identity records separate from ballot selections.
- Store a submitted ballot atomically; enforce uniqueness in the database, not only in browser code.
- Keep audit events append-only and exclude ballot choices and reset OTP values.
- Use transactions for payment verification, nomination approval and ballot submission.
- Store uploaded payment evidence in private object storage, not a public web directory.

## Configuration and secrets
- Keep database credentials, session secrets, SMS provider credentials and other secrets in deployment environment variables or a secrets manager.
- Never commit credentials, real student data, payment receipts, OTPs or production exports to Git.
- Provide a documented first-administrator bootstrap process that does not rely on a hard-coded password.

## Delivery sequence
1. Confirm hosting and SMS provider.
2. Implement schema, migrations, secure sessions and account registration/login.
3. Implement password-reset OTP and administrator bootstrap.
4. Implement moderation and election configuration.
5. Implement nominations, manual payment review and PDF forms.
6. Implement secret ballot, results and audit reporting.
7. Perform security review, load testing, backup/restore rehearsal and election simulation before any binding election.

## Release status
No production database, SMS integration, payment gateway or live voting service is configured by this document.


## Implemented voter eligibility and turnout controls
- Active student accounts are eligible by default for each election.
- An election administrator may record a reasoned, audited eligibility exclusion or restore eligibility for an individual student before voting opens.
- Eligibility changes are locked once voting opens; the voting service rechecks eligibility during ballot retrieval, authorisation and ballot submission.
- Aggregate participation reporting returns eligible and participating voter counts overall and by department. It does not expose individual participation rows or ballot choices through the dashboard.
