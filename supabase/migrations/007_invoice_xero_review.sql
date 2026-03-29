-- Migration 007: Invoice columns for Xero accuracy upgrade
-- Confirms all Xero-related columns are present on the invoices table.
-- Most were added in migration 006 — this migration adds any that were missed
-- and sets up the index needed for the review queue.
--
-- New columns:
--   inventory_item_code — top-level column for the primary item code
--   (per-line inventory_item_code is stored in the line_items JSONB)
--
-- xero_sync_status values:
--   pending  — not yet sent to Xero (default)
--   synced   — successfully pushed to Xero via the 3 PM batch
--   failed   — Xero API rejected the invoice; retry via xero-retry-failed
--   review   — gst_flagged=true; held back until manager sets correct GST treatment

-- Ensure all required columns exist (IF NOT EXISTS guards against duplicate runs)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_id    text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_sync_status   text NOT NULL DEFAULT 'pending';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_synced_at     timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_type           text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gst_flagged        boolean NOT NULL DEFAULT false;

-- Index for the GST review queue: quickly find all invoices needing manual attention
CREATE INDEX IF NOT EXISTS invoices_xero_review
  ON invoices (cafe_day, xero_sync_status)
  WHERE xero_sync_status = 'review';

-- Note: per-line-item inventory_item_code is stored inside the line_items JSONB
-- column as { inventory_item_code: "..." } — no separate top-level column is needed
-- since a single invoice can have multiple line items each with different item codes.
