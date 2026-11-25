-- Voting authorisations are identity-bound, short-lived, single-use credentials.
-- Only a SHA-256 hash is stored; the raw token is returned once to the authenticated voter.
CREATE TABLE IF NOT EXISTS voting_authorisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE RESTRICT,
  voter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voting_auth_user_election
  ON voting_authorisations(election_id, voter_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voting_auth_expiry
  ON voting_authorisations(expires_at) WHERE consumed_at IS NULL;

-- An office may have multiple seats, so a ballot may contain multiple selections
-- for the same office, but never the same candidate twice in that office.
ALTER TABLE ballot_selections
  DROP CONSTRAINT IF EXISTS ballot_selections_ballot_id_office_id_key;

ALTER TABLE ballot_selections
  ADD CONSTRAINT ballot_selections_ballot_office_candidate_key
  UNIQUE (ballot_id, office_id, candidate_nomination_id);
