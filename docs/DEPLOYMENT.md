# Render production deployment and go-live runbook

## Current status

The repository contains a Render Blueprint at `render.yaml`. It defines:
- Web service: `fss-unidel-voting`, Docker runtime, Frankfurt region, 1 CPU / 2 GB plan.
- Managed PostgreSQL: `fss-unidel-voting-db`, PostgreSQL 16, Frankfurt region, 0.5 CPU / 1 GB plan, 15 GB initial storage with storage autoscaling.
- Private database access only (`ipAllowList: []`); the web service connects using Render's internal database URL.
- Database TLS required for Render's internal PostgreSQL connection. Render uses self-signed certificates for internal TLS, so `DATABASE_SSL_MODE=require` encrypts traffic without CA verification. The application defaults to certificate verification for other production providers.
- Database migrations run as the paid web service's pre-deploy command (`npm run db:migrate`).
- Automatic deploys occur only after linked GitHub checks pass.
- Health check: `/api/health`.

**The repository is prepared but the Render resources have not been provisioned.** Creating the Blueprint provisions paid resources and incurs Render charges. Review the current prices and billing estimate in Render before confirming resource creation. Do not substitute free/ephemeral database storage for live election data.

## What the owner must provide or authorise

1. **Render account/workspace:** access to the Render workspace in which the service and database should be created. The owner should sign in and perform the provisioning; do not send Render passwords, recovery codes, or API tokens in chat.
2. **GitHub connection:** authorise Render to access `benedictagoha-code/FSS_UNIDEL-Electronic-Voting-system` and its `main` branch. The repository is currently public, but Render still needs a Git-provider connection for CI-gated automatic deployments.
3. **Billing approval:** approve the displayed cost for the web service and managed PostgreSQL database. Current plans and prices can change; check the Render dashboard before creating resources.
4. **Domain (optional initially):** either use the Render-provided `.onrender.com` address or provide an institutional domain and access to its DNS management. Render provisions TLS for supported custom domains after DNS is configured.
5. **Termii account for password-reset SMS:** provide the API key, approved sender ID, and exact HTTPS API base URL from the Termii dashboard directly in Render's environment settings. Do not put credentials in GitHub or this chat. The account must have the required transactional/DND route enabled. Until configured and tested, password-reset SMS remains unavailable; ordinary registration and sign-in do not require OTP.
6. **First super-administrator identity:** provide the exact matriculation/registration number of the already registered account that is to receive the first `super_admin` role. Verify the person's identity and authority through the institution before granting it.
7. **Election owner approval:** the institution must approve voter eligibility, nomination fee and payment instructions, election schedule, ballot/abstention rules, results publication, dispute handling and data-retention policy before a binding election.

No production database password, Render API token, Termii API key, session secret, or OTP pepper needs to be sent to the developer in chat. Render generates the session and OTP secrets from the Blueprint.

## Deployment steps in Render

1. Sign in to Render and connect the GitHub account that can access the repository.
2. Choose **New > Blueprint**, select `benedictagoha-code/FSS_UNIDEL-Electronic-Voting-system`, branch `main`, and let Render detect the root `render.yaml`.
3. Review the two paid resources, Frankfurt region, database plan/storage and estimated billing. Confirm only if the owner approves the cost.
4. Apply the Blueprint. Render provisions the web service and PostgreSQL database and supplies `DATABASE_URL` internally. The Blueprint generates distinct `SESSION_SECRET` and `OTP_PEPPER` values.
5. Wait for the image build, pre-deploy migrations and deployment. The service must pass `/api/health` before proceeding.
6. Open the generated Render URL over HTTPS. Confirm the landing page, registration, sign-in, password handling and protected admin routes.
7. Register the designated first administrator as an ordinary student account using the institution-verified matriculation/registration number. Do not register a fake or shared administrator identity.
8. Open the Render service's Shell (or run the one-time command from a trusted workstation with the database's external connection string and required environment variables). Set `ADMIN_BOOTSTRAP_CONFIRM=I_HAVE_SECURED_DATABASE_ACCESS` only for this operation and run:
   ```bash
   npm run admin:bootstrap -- MATRIC_OR_REGISTRATION_NUMBER
   ```
   Type `YES` at the confirmation prompt. The bootstrap refuses to run if any admin role already exists. Remove the temporary confirmation variable immediately afterward. Do not expose the bootstrap as a public HTTP endpoint.
9. Sign in with the existing account, confirm the super-admin role, then assign other administrators only the minimum roles they require.
10. Configure Termii in the Render service environment:
    - `SMS_PROVIDER=termii`
    - `TERMII_API_KEY` = secret API key from Termii
    - `TERMII_SENDER_ID` = approved 3–11 character alphanumeric sender ID
    - `TERMII_BASE_URL` = exact HTTPS base URL shown by Termii
    Save/redeploy, then test password reset to an authorised phone number and confirm the SMS arrives. Do not use a real student's number without permission.
11. Run a supervised mock election with test accounts. Verify candidate nominations, payment verification, eligibility decisions, voter snapshot, one-ballot enforcement, close, result publication, printed unopposed notices and audit records.
12. Configure and test database backups and restore, restrict workspace access, enable account MFA, and appoint at least two authorised institutional operators under the approved role policy before a live election.

## Required environment variables

The Blueprint sets these automatically:

| Variable | Source |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Render private Postgres connection string |
| `DATABASE_SSL_MODE` | `require` (Render internal TLS) |
| `SESSION_SECRET` | Generated by Render |
| `OTP_PEPPER` | Separately generated by Render |
| `TRUST_PROXY_HOPS` | `1` |
| `SMS_PROVIDER` | `unconfigured` until Termii is activated |

Render supplies `PORT`. Add the four Termii values manually only after the institution's Termii account is approved. No separate `APP_BASE_URL` is currently required by the application code; use the actual HTTPS service URL when sharing access.

## Operational safeguards and limitations

- The Render Blueprint uses a paid web plan because the database migration pre-deploy command is a paid-plan feature. It uses a paid managed database with persistent storage; this is deliberate for election records.
- Keep the database private. The Blueprint sets an empty external IP allow list; the Render web service can still connect over the private network.
- The app's `/api/health` endpoint checks database connectivity. A healthy HTTP response does not replace end-to-end election testing.
- Termii credentials are not in source control. SMS delivery cannot be considered active until the account, sender ID and DND route have been tested.
- Manual nomination-payment verification is implemented; there is no live bank/payment gateway integration.
- Participation and ballot selections are stored separately, but timestamps may be correlated by privileged database/server operators. Do not claim cryptographic unlinkability.
- Never use real student records for deployment smoke tests. Use synthetic test accounts and remove them under an approved, audited procedure before launch.
- Do not start a binding election until the institution has completed security review, mock election, backup/restore test, operational sign-off and communicated election rules.

## Rollback and recovery

Before schema-changing deployments, ensure a verified database backup exists. Prefer forward-only corrective migrations rather than editing an applied migration. Test restores in a separate database. Do not restore or roll back production election data without the election authority's approval and an incident record.
