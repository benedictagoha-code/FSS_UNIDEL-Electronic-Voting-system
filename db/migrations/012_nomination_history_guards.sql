-- Preserve nomination and payment history at the database boundary.
-- Application routes may perform only the documented lifecycle transitions.

CREATE OR REPLACE FUNCTION guard_nomination_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  election_status TEXT;
  payment_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Nomination history cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.election_id IS DISTINCT FROM OLD.election_id
     OR NEW.office_id IS DISTINCT FROM OLD.office_id
     OR NEW.candidate_user_id IS DISTINCT FROM OLD.candidate_user_id
     OR NEW.manifesto IS DISTINCT FROM OLD.manifesto
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Submitted nomination details are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.eligibility_status IS NOT DISTINCT FROM OLD.eligibility_status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.eligibility_status = 'pending'
      AND NEW.eligibility_status IN ('approved','rejected','withdrawn'))
    OR
    (OLD.eligibility_status = 'approved'
      AND NEW.eligibility_status = 'withdrawn')
  ) THEN
    RAISE EXCEPTION 'Invalid nomination status transition: % -> %',
      OLD.eligibility_status, NEW.eligibility_status
      USING ERRCODE = '55000';
  END IF;

  SELECT status INTO election_status
  FROM elections
  WHERE id = OLD.election_id
  FOR SHARE;

  IF election_status IS DISTINCT FROM 'nominations_open' THEN
    RAISE EXCEPTION 'Nomination status cannot change after nominations close'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.eligibility_status = 'approved' THEN
    SELECT verification_status INTO payment_status
    FROM nomination_payments
    WHERE nomination_id = OLD.id;

    IF payment_status IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'A nomination requires verified payment before approval'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nominations_history_guard ON nominations;
CREATE TRIGGER nominations_history_guard
BEFORE UPDATE OR DELETE ON nominations
FOR EACH ROW EXECUTE FUNCTION guard_nomination_history();

CREATE OR REPLACE FUNCTION guard_nomination_payment_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Nomination payment history cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.nomination_id IS DISTINCT FROM OLD.nomination_id
     OR NEW.amount_kobo IS DISTINCT FROM OLD.amount_kobo
     OR NEW.payment_channel IS DISTINCT FROM OLD.payment_channel
     OR NEW.transaction_reference IS DISTINCT FROM OLD.transaction_reference
     OR NEW.receipt_storage_key IS DISTINCT FROM OLD.receipt_storage_key
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Submitted nomination payment details are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN
    IF NEW.verified_by IS DISTINCT FROM OLD.verified_by
       OR NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
      RAISE EXCEPTION 'Nomination payment review attribution is immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.verification_status <> 'pending'
     OR NEW.verification_status NOT IN ('verified','rejected')
     OR NEW.verified_by IS NULL
     OR NEW.verified_at IS NULL THEN
    RAISE EXCEPTION 'Invalid nomination payment status transition'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nomination_payments_history_guard ON nomination_payments;
CREATE TRIGGER nomination_payments_history_guard
BEFORE UPDATE OR DELETE ON nomination_payments
FOR EACH ROW EXECUTE FUNCTION guard_nomination_payment_history();
