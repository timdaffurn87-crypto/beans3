-- 010_invoice_additional_photos.sql
--
-- Adds the additional_photo_urls column to the invoices table.
-- This stores the URLs of any extra photos beyond the primary photo_url
-- when a multi-page invoice is captured with multiple photos.

alter table invoices
  add column if not exists additional_photo_urls text[] default null;
