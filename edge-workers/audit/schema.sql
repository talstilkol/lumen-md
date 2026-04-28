-- Cloudflare D1 schema for the audit log (ε.2).
-- Apply with: wrangler d1 execute lumen-audit --file=schema.sql
-- The on-prem Postgres mirror of this lives in docker/postgres-init.sql.

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  org_id TEXT,
  action TEXT NOT NULL,
  payload_json TEXT,
  ip TEXT,
  user_agent TEXT,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_org_ts
  ON audit_events (org_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_audit_user_ts
  ON audit_events (user_id, ts DESC);
