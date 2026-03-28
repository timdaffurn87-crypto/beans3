-- Add Xero-required fields to the invoices table
-- supplier_email: optional, maps to Xero EmailAddress column
-- due_date: required for Xero import, defaults to 30 days after invoice_date

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS supplier_email text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date date;
