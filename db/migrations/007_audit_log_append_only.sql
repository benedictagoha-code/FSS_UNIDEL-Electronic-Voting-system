-- Audit records are append-only: corrections must be recorded as new events.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records are append-only'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE TRIGGER audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
