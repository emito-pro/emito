CREATE OR REPLACE FUNCTION emito_audit_log_immutable() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'emito_audit_log is append-only (008d immutability trigger)'
		USING ERRCODE = 'EM100';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_emito_audit_log_no_update BEFORE UPDATE ON emito_audit_log FOR EACH ROW EXECUTE FUNCTION emito_audit_log_immutable();
--> statement-breakpoint
CREATE TRIGGER trg_emito_audit_log_no_delete BEFORE DELETE ON emito_audit_log FOR EACH ROW EXECUTE FUNCTION emito_audit_log_immutable();
