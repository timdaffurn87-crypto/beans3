-- ============================================================================
-- 013_waste_inventory_link.sql
-- Adds an optional inventory_item_id column to waste_logs so waste can be
-- logged against inventory items (from invoices) as well as menu items.
-- Makes menu_item_id nullable so one or the other can be set.
-- ============================================================================

-- Make menu_item_id nullable (was NOT NULL with FK to menu_items)
alter table waste_logs alter column menu_item_id drop not null;

-- Add optional link to inventory_items
alter table waste_logs
  add column inventory_item_id uuid references inventory_items(id);

-- Add a check: at least one of menu_item_id or inventory_item_id must be set
alter table waste_logs
  add constraint waste_logs_item_check
  check (menu_item_id is not null or inventory_item_id is not null);
