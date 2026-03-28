-- Till reconciliation: formal accountability record logged at EOD.
-- One row per café day — staff explicitly confirm whether the till balanced.
-- Discrepancy amount and explanation are required when balanced = false.

create table if not exists till_reconciliation (
  id                  uuid        primary key default uuid_generate_v4(),
  cafe_day            date        not null unique,
  logged_by           uuid        not null references profiles(id),
  balanced            boolean     not null,
  discrepancy_amount  numeric,            -- null when balanced = true
  explanation         text,               -- null when balanced = true
  logged_at           timestamptz not null default now()
);

alter table till_reconciliation enable row level security;

create policy "All authenticated can insert till reconciliation"
  on till_reconciliation for insert to authenticated
  with check (auth.uid() = logged_by);

create policy "All authenticated can read till reconciliation"
  on till_reconciliation for select to authenticated using (true);
