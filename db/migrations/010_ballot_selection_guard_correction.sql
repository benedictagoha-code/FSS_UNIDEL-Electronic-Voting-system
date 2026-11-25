-- Correct the selection guard to lock the ballot's actual parent election.
-- Composite foreign keys remain responsible for rejecting a forged election_id.
CREATE OR REPLACE FUNCTION guard_open_election_selection_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE current_status TEXT;
BEGIN
  SELECT e.status INTO current_status
  FROM ballots b
  JOIN elections e ON e.id = b.election_id
  WHERE b.id = NEW.ballot_id
  FOR SHARE OF e;

  IF current_status IS DISTINCT FROM 'voting_open' THEN
    RAISE EXCEPTION 'Ballot selections may only be recorded while voting is open'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;


