# Render free-tier deployment and go-live preparation

## Current status

The repository contains a Render Blueprint at `render.yaml`. It defines a **free Render web service only**. It does not create a Render Postgres database because Render's free Postgres expires after 30 days. The app requires a separate PostgreSQL database whose free-plan data persists beyond 30 days.

The free web service:
- Uses the Docker runtime in Frankfurt.
- Sleeps after 15 minutes without inbound traffic and can take about a minute to wake.
- Has 512 MB RAM and limited CPU, and may restart at any time.
- Has no persistent local filesystem, no SSH/Shell access, and no one-off jobs.
- Is for testing/preview rather than a dependable production election service.

Render documents that free Postgres is limited to 1 GB, has no backups, and expires 30 days after creation. Do not use it for election records. See https://render.com/docs/free.

## Free database option

A free external PostgreSQL service is required. One option is Neon Free:
- PostgreSQL data storage persists and does not expire after 30 days.
- Current free allowance: 1 GB storage, 100 compute-hours/project/month, and 5 GB network transfer/project/month.
- Database compute scales to zero after inactivity and wakes on the next connection.
- It has usage limits; compute can be suspended when the allowance is exhausted.
- It is not a substitute for independently maintained backups or a production-grade election database.

Official details: https://neon.com/docs/introduction/plans and https://neon.com/docs/introduction/scale-to-zero.

The app will connect over public TLS using the Neon connection string. The Render Blueprint prompts for `DATABASE_URL`; the owner pastes the Neon pooled connection string into Render's environment settings, not into GitHub or this chat. Keep `DATABASE_SSL_MODE=require`.

## Deployment steps

1. Create a Neon Free project at https://console.neon.tech/ (or another compatible free PostgreSQL provider). Choose PostgreSQL 16 if available.
2. Copy the pooled PostgreSQL connection string from the provider dashboard. Keep it private.
3. Sign into Render at https://dashboard.render.com/ and connect GitHub access to `benedictagoha-code/FSS_UNIDEL-Electronic-Voting-system`, branch `main`.
4. Choose **New > Blueprint**, select the repository and branch `main`, and review the detected `render.yaml`. It provisions only a free web service; it does not provision any paid resources or a Render database.
5. When prompted for `DATABASE_URL`, paste the external free PostgreSQL connection string into Render's protected environment-variable field. Never commit it to GitHub or send it in chat.
6. Apply the Blueprint. Render generates `SESSION_SECRET` and `OTP_PEPPER` automatically.
7. On every container start, the Docker command runs `npm run db:migrate` before `npm start`. The migration runner records applied versions and skips them on subsequent starts. Confirm the logs show migrations completed and the service starts successfully.
8. Confirm the health endpoint `/api/health` returns HTTP 200. Open the HTTPS Render URL and test registration and sign-in using synthetic test accounts only.
9. Register the intended first administrator as an ordinary student account. Verify their identity and authority through the institution.
10. **First super-admin bootstrap:** Render Free web services do not provide Shell/SSH access and do not support one-off jobs. Run the bootstrap from a trusted workstation using the same production environment variables and database connection string:
    ```bash
    ADMIN_BOOTSTRAP_CONFIRM=I_HAVE_SECURED_DATABASE_ACCESS npm run admin:bootstrap -- MATRIC_OR_REGISTRATION_NUMBER
    ```
    The command prompts for `YES`, refuses if any admin role already exists, and uses the registered account. Run it only from a secured machine; do not paste the connection string into a shared terminal or chat. Unset the temporary confirmation variable immediately afterward.
11. Configure Termii only if password-reset SMS is required. In Render's environment settings set `SMS_PROVIDER=termii`, `TERMII_API_KEY`, `TERMII_SENDER_ID`, and `TERMII_BASE_URL`. The Termii account must have an approved sender ID and required DND route. Keep the API key private.
12. Run a supervised mock election with synthetic accounts. Verify nominations, manual payment review, eligibility, frozen voter snapshot, one-ballot enforcement, close, publication, printable unopposed notices and audit history.
13. Export database backups regularly using the provider's supported PostgreSQL dump/export tool. Store encrypted backups somewhere separate from both Render and the database provider, and test restoring one before considering a real election.

## Required Render environment variables

| Variable | Value/source |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | External free PostgreSQL connection string; entered privately during Blueprint setup |
| `DATABASE_SSL_MODE` | `require` |
| `SESSION_SECRET` | Generated by Render |
| `OTP_PEPPER` | Generated by Render, distinct from session secret |
| `TRUST_PROXY_HOPS` | `1` |
| `SMS_PROVIDER` | `unconfigured` until Termii is set up |
| `TERMII_API_KEY` | Add only after Termii account is ready |
| `TERMII_SENDER_ID` | Approved Termii sender ID |
| `TERMII_BASE_URL` | Exact HTTPS API base URL from Termii |

Render supplies `PORT`. The application does not currently require a separate `APP_BASE_URL`.

## Important limitations — not approved for a binding election

- Render Free is a preview/hobby service. It sleeps after 15 minutes of inactivity, has cold starts, limited resources and may restart at any time. It offers no uptime SLA.
- The external free database has quotas, scale-to-zero and no managed production-grade backup guarantee. Free tiers can change; monitor usage and keep independent backups.
- Render free web services have ephemeral filesystems. Never save authoritative election data, uploaded evidence or database files on the web-service filesystem.
- The free deployment is suitable for development, demonstrations and a supervised mock election, not for a binding faculty election requiring continuous availability, guaranteed recovery and dependable audit preservation.
- Manual nomination-payment verification is implemented; no live bank/payment gateway integration is included.
- Participation and ballot selections are stored separately, but timestamps may be correlated by privileged database/server operators. Do not claim cryptographic unlinkability.
- Do not start a binding election until the institution has approved election rules, completed independent security review, mock election, backup/restore test and operational sign-off.

## Recovery

Before any schema-changing deployment, export a verified database backup. Prefer forward-only corrective migrations rather than editing an applied migration. Test restores in a separate database. Never restore or roll back production election data without election-authority approval and an incident record.
