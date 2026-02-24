ALTER TABLE admin_audit_logs
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
  USING created_at AT TIME ZONE 'UTC';

ALTER TABLE admin_audit_logs
  ALTER COLUMN created_at SET DEFAULT now();
