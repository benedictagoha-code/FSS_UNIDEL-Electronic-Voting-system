ALTER TABLE elections DROP CONSTRAINT IF EXISTS elections_status_check;
ALTER TABLE elections ADD CONSTRAINT elections_status_check
  CHECK (status IN ('draft','nominations_open','nominations_closed','voting_open','closed','results_published','cancelled'));

ALTER TABLE ballots DROP COLUMN IF EXISTS cast_at;
ALTER TABLE ballot_selections DROP CONSTRAINT IF EXISTS ballot_selections_ballot_id_office_id_key;
-- Remove a previously-created version of this constraint/index before rebuilding it.
-- This keeps the migration safe if an earlier deployment created the index outside
-- the schema_migrations ledger.
ALTER TABLE ballot_selections
  DROP CONSTRAINT IF EXISTS ballot_selections_ballot_office_candidate_key;
DROP INDEX IF EXISTS ballot_selections_ballot_office_candidate_key;

ALTER TABLE ballot_selections
  ADD CONSTRAINT ballot_selections_ballot_office_candidate_key
  UNIQUE (ballot_id, office_id, candidate_nomination_id);

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
  ON voting_authorisations(voter_user_id, election_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_participation_election
  ON voter_participation(election_id, cast_at DESC);
CREATE INDEX IF NOT EXISTS idx_ballot_selections_nomination
  ON ballot_selections(candidate_nomination_id);
