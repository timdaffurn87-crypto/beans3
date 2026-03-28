-- Migration 006: Xero integration tables
-- Creates dedicated xero_tokens and gst_inclusive_suppliers tables.
-- Also adds Xero sync tracking columns to the invoices table.

-- ── xero_tokens ──────────────────────────────────────────────────────────────
-- Stores the Xero OAuth tokens. One row in this table = Xero is connected.
-- Managed exclusively by the xero-auth-callback Edge Function (writes)
-- and the xero-invoice-batch Edge Function (reads/updates refresh token).
CREATE TABLE IF NOT EXISTS xero_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token  text        NOT NULL,
  refresh_token text        NOT NULL,
  expires_at    timestamptz NOT NULL,
  tenant_id     text        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE xero_tokens ENABLE ROW LEVEL SECURITY;

-- Owner can SELECT (for status display) and DELETE (for disconnect)
-- Edge Functions use service role and bypass RLS entirely
CREATE POLICY "Owner can read and delete xero_tokens"
  ON xero_tokens TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
  );

-- ── gst_inclusive_suppliers ──────────────────────────────────────────────────
-- Supplier names whose invoices carry GST-inclusive totals.
-- All authenticated staff can read (needed for invoice scan screen).
-- Only owner can add/remove entries.
CREATE TABLE IF NOT EXISTS gst_inclusive_suppliers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gst_inclusive_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can read gst_inclusive_suppliers"
  ON gst_inclusive_suppliers FOR SELECT TO authenticated USING (true);

CREATE POLICY "Owner can manage gst_inclusive_suppliers"
  ON gst_inclusive_suppliers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- ── invoices table additions ──────────────────────────────────────────────────
-- xero_invoice_id was added in migration 005 — keep IF NOT EXISTS for safety.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_id    text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_sync_status   text        NOT NULL DEFAULT 'pending';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_synced_at     timestamptz;
-- tax_type stores the Xero LineAmountTypes value:
--   INCLUSIVE  = amounts include GST (Xero LineAmountTypes INCLUSIVE, TaxType INPUT)
--   EXCLUSIVE  = amounts exclude GST (Xero LineAmountTypes EXCLUSIVE, TaxType INPUT)
--   NOTAX      = no GST applies      (Xero LineAmountTypes NOTAX, TaxType NONE)
--   NULL       = undetermined, gst_flagged will be true
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_type           text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gst_flagged        boolean     NOT NULL DEFAULT false;

-- Index to efficiently pull un-synced invoices for the batch cron
CREATE INDEX IF NOT EXISTS invoices_xero_pending
  ON invoices (cafe_day, xero_sync_status)
  WHERE xero_sync_status = 'pending';
