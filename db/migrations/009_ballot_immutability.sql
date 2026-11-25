-- Ballots and participation are append-only. Ballot writes are accepted only
-- while the corresponding election is open; the election row lock serialises
-- this check with administrative close-voting operations.
CREATE OR REPLACE FUNCTION guard_open_election_ballot_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE current_status TEXT;
BEGIN
  SELECT status INTO current_status
  FROM elections
  WHERE id = NEW.election_id
  FOR SHARE;

  IF current_status IS DISTINCT FROM 'voting_open' THEN
    RAISE EXCEPTION 'Ballots may only be recorded while voting is open'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ballots_open_election_insert ON ballots;
CREATE TRIGGER ballots_open_election_insert
BEFORE INSERT ON ballots
FOR EACH ROW EXECUTE FUNCTION guard_open_election_ballot_insert();

CREATE OR REPLACE FUNCTION guard_open_election_selection_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE current_status TEXT;
BEGIN
  SELECT e.status INTO current_status
  FROM ballots b
  JOIN elections e ON e.id = b.election_id
  WHERE b.id = NEW.ballot_id AND b.election_id = NEW.election_id
  FOR SHARE OF e;

  IF current_status IS DISTINCT FROM 'voting_open' THEN
    RAISE EXCEPTION 'Ballot selections may only be recorded while voting is open'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ballot_selections_open_election_insert ON ballot_selections;
CREATE TRIGGER ballot_selections_open_election_insert
BEFORE INSERT ON ballot_selections
FOR EACH ROW EXECUTE FUNCTION guard_open_election_selection_insert();

CREATE OR REPLACE FUNCTION prevent_ballot_record_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Accepted ballot and participation records are immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS ballots_immutable ON ballots;
CREATE TRIGGER ballots_immutable
BEFORE UPDATE OR DELETE ON ballots
FOR EACH ROW EXECUTE FUNCTION prevent_ballot_record_mutation();

DROP TRIGGER IF EXISTS ballot_selections_immutable ON ballot_selections;
CREATE TRIGGER ballot_selections_immutable
BEFORE UPDATE OR DELETE ON ballot_selections
FOR EACH ROW EXECUTE FUNCTION prevent_ballot_record_mutation();

DROP TRIGGER IF EXISTS voter_participation_immutable ON voter_participation;
CREATE TRIGGER voter_participation_immutable
BEFORE UPDATE OR DELETE ON voter_participation
FOR EACH ROW EXECUTE FUNCTION prevent_ballot_record_mutation();
