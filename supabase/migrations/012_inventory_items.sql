-- ============================================================================
-- 012_inventory_items.sql
-- Creates the inventory_items table for tracking supplier stock items,
-- their current unit prices, default tax types, and price change history.
-- Invoices upsert into this table; waste and recipes can reference it.
-- ============================================================================

-- INVENTORY ITEMS — canonical stock/ingredient list derived from invoices
create table inventory_items (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  supplier_name text,                              -- last supplier who provided this item
  unit_of_measure text default 'each',             -- e.g. 'kg', 'litre', 'each', 'carton'
  unit_price numeric not null default 0,           -- current cost price (ex-GST for INPUT2, as-is for NONE/BASEXCLUDED)
  default_tax_type text not null default 'NONE'    -- learned tax type: 'NONE', 'INPUT2', 'BASEXCLUDED'
    check (default_tax_type in ('NONE', 'INPUT2', 'BASEXCLUDED')),
  xero_account_code text default '310',            -- default Xero account code
  xero_inventory_item_code text default '',         -- Xero InventoryItemCode if matched
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for fast lookup by name (case-insensitive)
create index inventory_items_name_idx on inventory_items (lower(name));

alter table inventory_items enable row level security;

-- All authenticated users can read inventory items
create policy "All authenticated can read inventory_items"
  on inventory_items for select to authenticated using (true);

-- All authenticated can insert (invoice scanning creates items)
create policy "All authenticated can insert inventory_items"
  on inventory_items for insert to authenticated with check (true);

-- All authenticated can update (price/tax updates on invoice save)
create policy "All authenticated can update inventory_items"
  on inventory_items for update to authenticated using (true);


-- INVENTORY PRICE HISTORY — log of price changes over time
create table inventory_price_history (
  id uuid primary key default uuid_generate_v4(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  old_price numeric,
  new_price numeric not null,
  supplier_name text,
  invoice_id uuid references invoices(id),          -- which invoice triggered this change
  changed_at timestamptz not null default now()
);

alter table inventory_price_history enable row level security;

create policy "All authenticated can read inventory_price_history"
  on inventory_price_history for select to authenticated using (true);

create policy "All authenticated can insert inventory_price_history"
  on inventory_price_history for insert to authenticated with check (true);

-- Index for looking up price history for a given item
create index inventory_price_history_item_idx on inventory_price_history (inventory_item_id, changed_at desc);
