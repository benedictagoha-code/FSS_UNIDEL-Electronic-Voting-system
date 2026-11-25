-- Freeze the eligible voter roll at the instant voting is scheduled to open.
-- Later account moderation prevents casting a ballot, but does not rewrite the
-- denominator used for the election's turnout report.
CREATE TABLE IF NOT EXISTS election_voter_snapshots (
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE RESTRICT,
  voter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (election_id, voter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_election_voter_snapshots_election
  ON election_voter_snapshots (election_id, voter_user_id);
