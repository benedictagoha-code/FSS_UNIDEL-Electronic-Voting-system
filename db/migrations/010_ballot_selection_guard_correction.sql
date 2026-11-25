-- Validate the ballot's actual parent election. If the submitted election ID
-- differs, defer to the composite foreign key so it returns the integrity error.
CREATE OR REPLACE FUNCTION guard_open_election_selection_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_status TEXT;
  ballot_election_id UUID;
BEGIN
  SELECT b.election_id, e.status
    INTO ballot_election_id, current_status
  FROM ballots b
  JOIN elections e ON e.id = b.election_id
  WHERE b.id = NEW.ballot_id
  FOR SHARE OF e;

  IF ballot_election_id IS DISTINCT FROM NEW.election_id THEN
    RETURN NEW;
  END IF;

  IF current_status IS DISTINCT FROM 'voting_open' THEN
    RAISE EXCEPTION 'Ballot selections may only be recorded while voting is open'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
