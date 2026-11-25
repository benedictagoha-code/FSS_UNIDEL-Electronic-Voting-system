# Security and Election Integrity Model

## Account registration and authentication
- Registration is self-service and does not use OTP.
- Each student chooses a password; passwords are never stored or displayed in plaintext.
- Matriculation/registration number and phone number are unique account identifiers.
- Normal login uses the account identifier and password.
- OTP is required only for password reset and is sent to the phone number already stored on the account.
- Reset codes are short-lived, single-use, rate-limited and stored only as secure verifiers.
- Changing a registered phone number requires an administrator-controlled recovery procedure.
- Because no official student register is required, administrators must be able to review and suspend questionable registrations before voting opens. A matriculation number alone does not cryptographically prove identity.

## Account moderation
- Mute: disables discussion/posting features only; does not disable login or voting.
- Suspend: blocks account access for a defined period and therefore prevents voting while active.
- Deactivate/remove: disables platform access while retaining records required for audit and election integrity.
- Restore: reverses a reversible moderation state.
- Every action requires a reason and records the administrator, timestamp, target account and action.
- Only authorised roles may perform moderation; privileged actions require server-side authorisation.

## Nominations and payments
- A candidate may submit multiple nominations where the election rules permit.
- A candidate/office/election combination may be nominated only once.
- Each nomination has its own reference and downloadable form.
- Payment verification is separate from nomination eligibility and approval.
- Payment account details and fees are administrator-configurable.
- Manual payment evidence is private; verification decisions are audited.

## Secret ballot
- Enforce eligibility and one accepted ballot per eligible voter/election in server-side code and database constraints.
- Separate voter identity/participation records from ballot selections.
- Do not place voter identity, matriculation number, phone number or account ID in ballot-choice records.
- Do not expose ballot choices in ordinary administrator dashboards or audit logs.
- A vote already accepted must not be editable or deletable by administrators.
- Publish results only through an authorised, audited action after the configured close time or authorised close procedure.

## Operational controls
- HTTPS only; secure, HttpOnly and SameSite session cookies.
- CSRF protection for state-changing browser requests.
- Rate limits on login, registration, password reset and sensitive actions.
- Parameterised database queries and strict input validation.
- Least-privilege database and application credentials.
- Append-only audit events for privileged actions.
- Encrypted backups, tested restoration and documented incident response.
- Independent security review and a full mock-election rehearsal before binding use.

## Explicit non-goals
- No OTP during registration or ordinary login.
- No automatic payment confirmation in the initial release.
- No administrator ability to inspect or alter an individual's ballot choices.
- No production use until hosting, database, SMS delivery, backup and security testing are complete.


## Secret ballot and verifiable participation

- Authentication identifies the eligible voter before a ballot is issued.
- A short-lived, random, single-use authorisation is returned to the authenticated browser; only its SHA-256 hash is stored with the voter identity.
- The authorisation is consumed when the ballot is accepted. The ballot row and its selections have no voter identifier or participation-row reference.
- The participation table records the voter and election with a unique constraint, independently of ballot content.
- Ballot selections are immutable through public application routes; no administrator endpoint exposes individual ballot records.
- Election status transitions are controlled: nominations open → nominations closed → voting open → closed → results published.
- Results endpoints return aggregate candidate totals only after publication.

The implementation reduces ordinary application-level linkage. It does not claim cryptographic unlinkability against privileged infrastructure operators; independent review and restricted database access remain necessary before a high-stakes election.


## Election-specific voter eligibility and participation
- Active accounts are eligible by default unless an election-specific exclusion is recorded.
- Exclusions require an administrator reason and are audited. Eligibility changes are locked as soon as the voting schedule is activated, before the scheduled opening time.
- At schedule activation, the system snapshots the active, eligible student roll. The snapshot fixes the turnout denominator and prevents later account-status changes from rewriting the historical eligible-voter count.
- The voting service checks the frozen voter roll and current account status at ballot retrieval, authorisation and submission; inactive, suspended or deactivated accounts cannot cast a ballot.
- Participation reports expose only aggregate eligible and participating counts, including department totals. They do not expose ballot choices.
- Composite database constraints bind each selection to its ballot, election, office and nomination, preventing cross-election or cross-office references.
- Ballot and participation records currently retain timestamps. Separation of tables reduces ordinary application-level linkage but does not provide cryptographic unlinkability against privileged database or server operators.


## Audit register and results publication

- The administrative audit register is read-only and restricted to super administrators.
- It supports bounded pagination and filtering by action and entity type; entries are ordered newest first.
- Audit entries identify the acting administrator and retain event metadata, but the register does not query ballot selections or expose an individual's candidate choices.
- Results publication is a separate authorised transition from `closed` to `results_published`; the transition and its audit event are committed together.
- Ordinary student accounts cannot access the audit register. Audit access itself should be monitored and the underlying database audit records retained in protected backups.

- PostgreSQL triggers reject UPDATE and DELETE operations on audit records. Any correction must be captured as a new audit event; routine test cleanup uses disposable database truncation only.


## Password-reset session revocation

After a password reset is successfully verified, the application updates the Argon2id password hash, consumes outstanding reset codes, and deletes all persisted login sessions belonging to that account. The user must authenticate again with the new password on every device. This reduces the risk that a stolen or unattended session remains usable after account recovery.


## Database-enforced election lifecycle

PostgreSQL enforces the election status sequence: draft → nominations open → nominations closed → voting open → closed → results published. Cancellation is permitted only before voting begins. Skipping a stage or reopening a completed stage is rejected by a database trigger. Election title, description and nomination-window settings become immutable once nominations have opened. Office creation, modification and deletion are restricted to draft elections. These protections apply even if an application route is bypassed.


## Ballot immutability and voting-window enforcement

PostgreSQL rejects ballot, selection and voter-participation updates or deletions. Ballot and selection inserts are accepted only while the election is in the voting-open state; database row locks coordinate these checks with election closure. The application also validates eligibility, one-use authorisation and candidate/office consistency inside a transaction. These controls make direct database tampering and route bypass materially harder, but do not make the system invulnerable: production security still depends on hardened hosting, restricted database credentials, protected secrets, patching, backups, monitoring, independent testing and incident response.

## Results visibility

Interim vote totals are not exposed to students, candidates or the public while voting is open. Results remain unavailable until voting has closed and an authorised results officer or super administrator publishes them. The published results board refreshes automatically every 15 seconds. Publication is a one-way lifecycle transition; no tally is disclosed during the live voting period.

## Browser request and login hardening

- State-changing requests reject mismatched Origin headers and use Fetch Metadata (Sec-Fetch-Site) as a second browser-side signal. Cross-site requests are rejected even when an Origin header is absent. Non-browser clients that send neither header remain supported; production integrations must authenticate independently and must not rely on browser cookies.
- Login performs an Argon2id verification against a dummy hash when the submitted student number does not exist. This reduces (but cannot completely eliminate) timing differences that could otherwise help enumerate registered student numbers.
- Login and password-reset endpoints are rate-limited. The built-in Express rate-limit memory store is suitable only for a single application process; a multi-instance production deployment must use a shared rate-limit store and monitor throttling events.

## Production database privilege separation

Use separate PostgreSQL identities for schema migrations and normal application traffic. The migration identity may own schema objects and apply numbered migrations; the runtime identity should receive only the minimum required table and sequence privileges and must not own the schema or have permission to disable triggers, alter tables, or change database roles. Keep database administration credentials outside the application environment. This separation is essential because database triggers cannot protect election records from an operator who can alter or disable those triggers.
