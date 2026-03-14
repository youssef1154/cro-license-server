-- ============================================================
-- CRO License System — Supabase Database Schema
-- ============================================================
-- Run this SQL in your Supabase project:
--   Dashboard → SQL Editor → New Query → paste this → Run
-- ============================================================

-- Main licenses table
CREATE TABLE IF NOT EXISTS licenses (
  id               BIGSERIAL PRIMARY KEY,
  license_key      TEXT NOT NULL UNIQUE,
  order_id         TEXT,
  customer_email   TEXT NOT NULL,
  product_id       TEXT NOT NULL,
  shop_domain      TEXT,              -- null until first activation
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at     TIMESTAMPTZ,       -- set when shop_domain first bound
  revoked_at       TIMESTAMPTZ        -- set if license revoked
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_licenses_key    ON licenses (license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_email  ON licenses (customer_email);
CREATE INDEX IF NOT EXISTS idx_licenses_order  ON licenses (order_id);
CREATE INDEX IF NOT EXISTS idx_licenses_domain ON licenses (shop_domain);

-- Usage log table (tracks every validation attempt)
CREATE TABLE IF NOT EXISTS license_usage_logs (
  id           BIGSERIAL PRIMARY KEY,
  license_id   BIGINT REFERENCES licenses(id) ON DELETE CASCADE,
  shop_domain  TEXT,
  section_id   TEXT,
  event_type   TEXT,    -- 'valid_check', 'domain_mismatch', 'first_activation'
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_license_id ON license_usage_logs (license_id);
CREATE INDEX IF NOT EXISTS idx_logs_logged_at  ON license_usage_logs (logged_at DESC);

-- ── Row Level Security ─────────────────────────────────────
-- Since we use the SERVICE KEY server-side, disable RLS for server operations
-- but enable it to prevent direct client access
ALTER TABLE licenses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_usage_logs ENABLE ROW LEVEL SECURITY;

-- No public access — only service key (used server-side) can read/write
CREATE POLICY "No public access to licenses"
  ON licenses FOR ALL USING (FALSE);

CREATE POLICY "No public access to logs"
  ON license_usage_logs FOR ALL USING (FALSE);

-- ── Sample data (optional, for testing) ───────────────────
-- INSERT INTO licenses (license_key, order_id, customer_email, product_id)
-- VALUES ('CRO-TEST-1234-ABCD-5678', 'test_order_001', 'test@example.com', 'cro-booster-pack');

-- ── Helpful views ──────────────────────────────────────────
CREATE OR REPLACE VIEW license_summary AS
SELECT
  l.license_key,
  l.customer_email,
  l.product_id,
  l.shop_domain,
  l.is_active,
  l.created_at,
  l.activated_at,
  COUNT(logs.id) AS total_checks
FROM licenses l
LEFT JOIN license_usage_logs logs ON logs.license_id = l.id
GROUP BY l.id
ORDER BY l.created_at DESC;
