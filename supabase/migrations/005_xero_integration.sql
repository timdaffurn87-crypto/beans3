-- Migration 005: Xero integration
-- Adds xero_invoice_id to invoices so we can track which bills were successfully
-- pushed to Xero and avoid duplicate submissions on resubmit.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_id text;

-- Index for quick lookup of un-sent invoices
CREATE INDEX IF NOT EXISTS invoices_xero_invoice_id_null
  ON invoices (cafe_day)
  WHERE xero_invoice_id IS NULL;
