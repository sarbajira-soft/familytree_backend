-- For maintaining the audit logs of the admin actions

CREATE TABLE admin_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_id INT NOT NULL
    REFERENCES ft_admin_login(id) ON DELETE RESTRICT,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id INT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_logs_admin_date
ON admin_audit_logs(admin_id, created_at DESC);

CREATE INDEX idx_admin_logs_created_at
ON admin_audit_logs(created_at);