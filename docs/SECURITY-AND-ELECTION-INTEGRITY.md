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
- Exclusions require an administrator reason and are audited. Eligibility changes are prohibited after voting opens.
- The voting service checks eligibility server-side at ballot retrieval, authorisation and submission; inactive, suspended or deactivated accounts cannot vote.
- Participation reports expose only aggregate eligible and participating counts, including department totals. They do not expose ballot choices.
- Composite database constraints bind each selection to its ballot, election, office and nomination, preventing cross-election or cross-office references.
- Ballot and participation records currently retain timestamps. Separation of tables reduces ordinary application-level linkage but does not provide cryptographic unlinkability against privileged database or server operators.
