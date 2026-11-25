CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matric_number VARCHAR(40) NOT NULL UNIQUE,
  phone_e164 VARCHAR(20) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  account_status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active','suspended','deactivated')),
  muted_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  full_name VARCHAR(180) NOT NULL,
  sex VARCHAR(20) NOT NULL CHECK (sex IN ('Female','Male')),
  department VARCHAR(120) NOT NULL,
  level VARCHAR(20) NOT NULL,
  matric_type VARCHAR(20) NOT NULL CHECK (matric_type IN ('matriculation','registration')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_roles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  role VARCHAR(30) NOT NULL CHECK (role IN ('super_admin','election_admin','finance_admin','moderator','results_officer')),
  granted_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS elections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(180) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','nominations_open','voting_open','closed','results_published','cancelled')),
  nomination_opens_at TIMESTAMPTZ,
  nomination_closes_at TIMESTAMPTZ,
  voting_opens_at TIMESTAMPTZ,
  voting_closes_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS election_offices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE RESTRICT,
  title VARCHAR(120) NOT NULL,
  nomination_fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (nomination_fee_kobo >= 0),
  seats INTEGER NOT NULL DEFAULT 1 CHECK (seats > 0),
  UNIQUE (election_id, title)
);

CREATE TABLE IF NOT EXISTS nominations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(40) NOT NULL UNIQUE,
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE RESTRICT,
  office_id UUID NOT NULL REFERENCES election_offices(id) ON DELETE RESTRICT,
  candidate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  manifesto TEXT,
  eligibility_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (eligibility_status IN ('pending','approved','rejected','withdrawn')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (election_id, office_id, candidate_user_id)
);

CREATE TABLE IF NOT EXISTS nomination_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id UUID NOT NULL UNIQUE REFERENCES nominations(id) ON DELETE RESTRICT,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 0),
  payment_channel VARCHAR(40) NOT NULL,
  transaction_reference VARCHAR(120),
  receipt_storage_key TEXT,
  verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','verified','rejected')),
  verified_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Participation is stored separately from anonymous ballot content.
CREATE TABLE IF NOT EXISTS voter_participation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE RESTRICT,
  voter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cast_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (election_id, voter_user_id)
);

-- Ballots deliberately contain no voter/user identifier.
CREATE TABLE IF NOT EXISTS ballots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE RESTRICT,
  cast_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ballot_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ballot_id UUID NOT NULL REFERENCES ballots(id) ON DELETE RESTRICT,
  office_id UUID NOT NULL REFERENCES election_offices(id) ON DELETE RESTRICT,
  candidate_nomination_id UUID NOT NULL REFERENCES nominations(id) ON DELETE RESTRICT,
  UNIQUE (ballot_id, office_id)
);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action VARCHAR(20) NOT NULL CHECK (action IN ('mute','suspend','deactivate','restore')),
  reason TEXT NOT NULL,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80),
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nominations_election_office ON nominations(election_id, office_id);
CREATE INDEX IF NOT EXISTS idx_ballots_election ON ballots(election_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reset_otps_user_created ON password_reset_otps(user_id, created_at DESC);
