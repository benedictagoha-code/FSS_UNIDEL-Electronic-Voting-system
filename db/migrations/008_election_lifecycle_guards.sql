-- Enforce election lifecycle and draft-only office configuration in PostgreSQL.
CREATE OR REPLACE FUNCTION guard_election_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('nominations_open','cancelled')) OR
      (OLD.status = 'nominations_open' AND NEW.status IN ('nominations_closed','cancelled')) OR
      (OLD.status = 'nominations_closed' AND NEW.status IN ('voting_open','cancelled')) OR
      (OLD.status = 'voting_open' AND NEW.status = 'closed') OR
      (OLD.status = 'closed' AND NEW.status = 'results_published')
    ) THEN
      RAISE EXCEPTION 'Invalid election status transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF OLD.status <> 'draft' AND (
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.description IS DISTINCT FROM OLD.description OR
    NEW.nomination_opens_at IS DISTINCT FROM OLD.nomination_opens_at OR
    NEW.nomination_closes_at IS DISTINCT FROM OLD.nomination_closes_at
  ) THEN
    RAISE EXCEPTION 'Election details are locked after nominations open'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS elections_lifecycle_guard ON elections;
CREATE TRIGGER elections_lifecycle_guard
BEFORE UPDATE ON elections
FOR EACH ROW EXECUTE FUNCTION guard_election_lifecycle();

CREATE OR REPLACE FUNCTION guard_election_office_draft_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_election_id UUID;
  current_status VARCHAR(20);
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_election_id := OLD.election_id;
  ELSE
    target_election_id := NEW.election_id;
  END IF;

  SELECT status INTO current_status FROM elections WHERE id = target_election_id FOR UPDATE;
  IF current_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Election offices can only be changed while the election is a draft'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS election_offices_draft_only ON election_offices;
CREATE TRIGGER election_offices_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON election_offices
FOR EACH ROW EXECUTE FUNCTION guard_election_office_draft_only();
