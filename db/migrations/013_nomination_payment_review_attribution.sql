-- Review attribution must remain immutable after a payment decision.
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
