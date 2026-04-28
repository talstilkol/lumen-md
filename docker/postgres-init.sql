-- Lumen on-prem Postgres init script. Runs once on first container start.
-- Tables here mirror the D1 schema used in the Cloudflare deployment.

-- ── Persistent collab snapshots ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_snapshots (
  room TEXT NOT NULL,
  vector BYTEA NOT NULL,
  doc_state BYTEA NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room, ts)
);
CREATE INDEX IF NOT EXISTS idx_room_snapshots_latest
  ON room_snapshots (room, ts DESC);

-- ── Billing entitlements (mirrors D1) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS entitlements (
  user_id TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end BIGINT,
  fine_tune_model TEXT,
  updated_at BIGINT NOT NULL
);

-- ── Audit log (ε.2) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  org_id TEXT,
  action TEXT NOT NULL,
  payload_json JSONB,
  ip TEXT,
  user_agent TEXT,
  ts BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_org_ts
  ON audit_events (org_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_ts
  ON audit_events (user_id, ts DESC);

-- ── Published documents (P3-08) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS published_docs (
  slug TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  salt BYTEA NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_published_user
  ON published_docs (user_id, updated_at DESC);
