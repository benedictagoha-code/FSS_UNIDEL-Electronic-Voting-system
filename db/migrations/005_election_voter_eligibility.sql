-- Election-specific voter eligibility overrides.
-- If no row exists for a student/election pair, an active student is eligible by default.
CREATE TABLE IF NOT EXISTS election_voter_eligibility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE RESTRICT,
  voter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  eligible BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (election_id, voter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_election_voter_eligibility_election
  ON election_voter_eligibility (election_id, eligible);
