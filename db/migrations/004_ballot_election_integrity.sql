-- Enforce election/office/nomination consistency at the database layer.
-- Existing rows are backfilled from their parent ballot before constraints are applied.
ALTER TABLE election_offices
  ADD CONSTRAINT election_offices_id_election_unique UNIQUE (id, election_id);

ALTER TABLE nominations
  ADD CONSTRAINT nominations_id_election_office_unique UNIQUE (id, election_id, office_id);

ALTER TABLE ballots
  ADD CONSTRAINT ballots_id_election_unique UNIQUE (id, election_id);

ALTER TABLE ballot_selections
  ADD COLUMN election_id UUID;

UPDATE ballot_selections bs
SET election_id = b.election_id
FROM ballots b
WHERE b.id = bs.ballot_id;

ALTER TABLE ballot_selections
  ALTER COLUMN election_id SET NOT NULL;

ALTER TABLE ballot_selections
  DROP CONSTRAINT IF EXISTS ballot_selections_ballot_id_fkey,
  DROP CONSTRAINT IF EXISTS ballot_selections_office_id_fkey,
  DROP CONSTRAINT IF EXISTS ballot_selections_candidate_nomination_id_fkey;

ALTER TABLE ballot_selections
  ADD CONSTRAINT ballot_selections_ballot_election_fk
    FOREIGN KEY (ballot_id, election_id)
    REFERENCES ballots (id, election_id) ON DELETE RESTRICT,
  ADD CONSTRAINT ballot_selections_office_election_fk
    FOREIGN KEY (office_id, election_id)
    REFERENCES election_offices (id, election_id) ON DELETE RESTRICT,
  ADD CONSTRAINT ballot_selections_nomination_office_election_fk
    FOREIGN KEY (candidate_nomination_id, election_id, office_id)
    REFERENCES nominations (id, election_id, office_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_ballot_selections_election
  ON ballot_selections (election_id, office_id);
