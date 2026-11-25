# Production deployment guide

## Current release readiness

The application is container-ready, but it is **not yet deployed**. A production host, managed PostgreSQL database, domain/TLS, institutional Termii credentials and the first authorised super-administrator must be configured before a live election can be operated.

## Runtime requirements

- Node.js 20 or the supplied Docker image
- PostgreSQL 16 (managed PostgreSQL recommended)
- HTTPS and a trusted TLS-terminating reverse proxy
- Persistent, private environment-variable/secret storage
- A backup and restore procedure for PostgreSQL

## Required server environment

Set these values in the hosting provider's secret/environment settings; do not commit them:

| Variable | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Set by host; otherwise 3000 |
| `APP_BASE_URL` | Final HTTPS application URL |
| `DATABASE_URL` | Private PostgreSQL connection string |
| `SESSION_SECRET` | Random secret, at least 32 characters |
| `OTP_PEPPER` | Different random secret, at least 32 characters |
| `SESSION_MAX_AGE_MS` | Optional; default 8 hours |
| `TRUST_PROXY_HOPS` | Exact trusted proxy count; default 1 |

For password-reset SMS, also configure `SMS_PROVIDER=termii`, `TERMII_API_KEY`, `TERMII_SENDER_ID` and `TERMII_BASE_URL` using the values from the institution's Termii account. Termii must have the approved sender ID and transactional DND route enabled. Do not enable live password resets until a real test message is received by an authorised test account.

The application expects PostgreSQL TLS in production and validates the server certificate. Use a provider connection string/certificate configuration compatible with that requirement; do not disable certificate validation as a deployment shortcut.

## Deployment sequence

1. Create a private PostgreSQL 16 database and a restricted application database user. Keep the database private to the application/network where possible.
2. Deploy the repository's `main` branch using the Dockerfile, or use Node.js 20 with `npm install` and `npm start`.
3. Configure all required environment variables and the final HTTPS `APP_BASE_URL`.
4. Run `npm run db:migrate` once as a release/pre-deploy command against the production database. The migration runner applies pending numbered migrations transactionally and records them in `schema_migrations`. Take a database backup before applying migrations to an existing database.
5. Configure the host's health check to request `/api/health`. It returns HTTP 200 only when the database responds.
6. Register the intended institutional administrator through the student registration page. Verify the matriculation/registration number and identity outside the application.
7. Run the one-time super-admin bootstrap from a trusted server shell/release console only:
   ```bash
   ADMIN_BOOTSTRAP_CONFIRM=I_HAVE_SECURED_DATABASE_ACCESS npm run admin:bootstrap -- MATRIC_OR_REGISTRATION_NUMBER
   ```
   Confirm the prompt with `YES`. Never expose this operation as a public endpoint; do not retain the confirmation variable after setup.
8. Sign in as the super administrator and create/verify the remaining role assignments using least privilege.
9. Configure Termii and verify password-reset SMS end-to-end using an authorised test account. If SMS is not ready, do not advertise password reset as operational.
10. Run a supervised mock election with test accounts, verify nominations/payment review, voter eligibility, ballot submission, closure, publication, printed summary and audit review.
11. Configure automated encrypted database backups, retention, access monitoring and a tested restore procedure before real election data is entered.

## Go-live restrictions

- Do not use real student records for development or tests.
- Do not launch a binding election until the institution has approved the election rules, voter eligibility process, nomination fees, ballot/abstention rules, result publication procedure and dispute process.
- Conduct an independent security review and a supervised mock election. CI passing does not establish operational security or live SMS delivery.
- The application separates voter participation from ballot choices, but timestamps can potentially be correlated by privileged infrastructure operators. Do not describe it as cryptographically unlinkable.
- Manual nomination-payment verification is implemented; there is no bank/payment gateway integration.
- Keep database credentials, Termii API keys, session secrets and OTP pepper exclusively in the host's secret manager.

## Rollback and recovery

Before every deployment that changes database schema, take a verified backup. Prefer forward-only corrective migrations rather than editing an already-applied migration. Test restoration in a separate database. Do not restore or roll back production data without the election authority's approval and an incident record.
