-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- PROFILES
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('barista', 'manager', 'owner')),
  pin text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "All authenticated users can read profiles"
  on profiles for select to authenticated using (true);

create policy "Users can update their own profile"
  on profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Owners can update any profile"
  on profiles for update to authenticated
  using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'
  ));

-- CALIBRATIONS
create table calibrations (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid not null references profiles(id),
  grinder_setting numeric not null,
  dose_grams numeric not null,
  yield_grams numeric not null,
  time_seconds numeric not null,
  ratio numeric generated always as (yield_grams / dose_grams) stored,
  notes text,
  cafe_day date not null,
  created_at timestamptz not null default now()
);

alter table calibrations enable row level security;

create policy "All authenticated can read calibrations"
  on calibrations for select to authenticated using (true);

create policy "All authenticated can insert calibrations"
  on calibrations for insert to authenticated with check (auth.uid() = staff_id);

-- MENU ITEMS
create table menu_items (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text not null check (category in ('coffee', 'food', 'beverage', 'retail')),
  sell_price numeric not null default 0,
  cost_price numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table menu_items enable row level security;

create policy "All authenticated can read menu items"
  on menu_items for select to authenticated using (true);

create policy "Managers and owners can insert menu items"
  on menu_items for insert to authenticated
  with check (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('manager', 'owner')
  ));

create policy "Managers and owners can update menu items"
  on menu_items for update to authenticated
  using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('manager', 'owner')
  ));

create policy "Managers and owners can delete menu items"
  on menu_items for delete to authenticated
  using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('manager', 'owner')
  ));

-- WASTE LOGS
create table waste_logs (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid not null references profiles(id),
  menu_item_id uuid not null references menu_items(id),
  item_name text not null,
  quantity numeric not null,
  unit_cost numeric not null,
  total_cost numeric not null,
  reason text not null,
  notes text,
  cafe_day date not null,
  created_at timestamptz not null default now()
);

alter table waste_logs enable row level security;

create policy "All authenticated can read waste logs"
  on waste_logs for select to authenticated using (true);

create policy "All authenticated can insert waste logs"
  on waste_logs for insert to authenticated with check (auth.uid() = staff_id);

-- TASK TEMPLATES
create table task_templates (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  station text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table task_templates enable row level security;

create policy "All authenticated can read task templates"
  on task_templates for select to authenticated using (true);

create policy "Managers and owners can manage task templates"
  on task_templates for all to authenticated
  using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('manager', 'owner')
  ))
  with check (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('manager', 'owner')
  ));

-- DAILY TASKS
create table daily_tasks (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid not null references task_templates(id),
  cafe_day date not null,
  title text not null,
  description text,
  station text not null,
  completed_by uuid references profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table daily_tasks enable row level security;

create policy "All authenticated can read daily tasks"
  on daily_tasks for select to authenticated using (true);

create policy "All authenticated can update daily tasks"
  on daily_tasks for update to authenticated using (true);

-- INVOICES
create table invoices (
  id uuid primary key default uuid_generate_v4(),
  scanned_by uuid not null references profiles(id),
  supplier_name text not null,
  invoice_date date,
  reference_number text,
  total_amount numeric not null default 0,
  line_items jsonb not null default '[]',
  photo_url text not null default '',
  ai_confidence text check (ai_confidence in ('high', 'medium', 'low')),
  status text not null default 'pending' check (status in ('pending', 'submitted')),
  cafe_day date not null,
  created_at timestamptz not null default now()
);

alter table invoices enable row level security;

create policy "All authenticated can read invoices"
  on invoices for select to authenticated using (true);

create policy "All authenticated can insert invoices"
  on invoices for insert to authenticated with check (auth.uid() = scanned_by);

create policy "All authenticated can update invoice status"
  on invoices for update to authenticated using (true);

-- RECIPES
create table recipes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text not null check (category in ('coffee', 'food', 'beverage')),
  ingredients jsonb not null default '[]',
  method jsonb not null default '[]',
  notes text,
  photo_url text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table recipes enable row level security;

create policy "All authenticated can read recipes"
  on recipes for select to authenticated using (true);

create policy "Managers and owners can manage recipes"
  on recipes for all to authenticated
  using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('manager', 'owner')
  ))
  with check (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('manager', 'owner')
  ));

-- EOD REPORTS
create table eod_reports (
  id uuid primary key default uuid_generate_v4(),
  submitted_by uuid not null references profiles(id),
  cafe_day date not null unique,
  tasks_completed integer not null default 0,
  tasks_total integer not null default 0,
  waste_total_value numeric not null default 0,
  waste_top_items jsonb not null default '[]',
  calibration_count integer not null default 0,
  calibration_compliance_pct numeric not null default 0,
  calibration_gaps jsonb,
  invoices_count integer not null default 0,
  invoices_total_value numeric not null default 0,
  invoice_ids uuid[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);

alter table eod_reports enable row level security;

create policy "All authenticated can read EOD reports"
  on eod_reports for select to authenticated using (true);

create policy "All authenticated can insert EOD reports"
  on eod_reports for insert to authenticated with check (auth.uid() = submitted_by);

-- SETTINGS
create table settings (
  id uuid primary key default uuid_generate_v4(),
  key text not null unique,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table settings enable row level security;

create policy "All authenticated can read non-sensitive settings"
  on settings for select to authenticated
  using (key not in ('claude_api_key', 'xero_api_key'));

create policy "Owners can manage settings"
  on settings for all to authenticated
  using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'
  ))
  with check (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'
  ));

-- Insert default settings
insert into settings (key, value) values
  ('cafe_day_start', '05:30'),
  ('cafe_day_end', '15:00'),
  ('target_daily_waste', '50.00'),
  ('target_task_completion', '90'),
  ('target_calibration_compliance', '100');

-- ACTIVITY LOG
create table activity_log (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid not null references profiles(id),
  action_type text not null,
  description text not null,
  amount numeric,
  cafe_day date not null,
  created_at timestamptz not null default now()
);

alter table activity_log enable row level security;

create policy "All authenticated can read activity log"
  on activity_log for select to authenticated using (true);

create policy "All authenticated can insert activity log"
  on activity_log for insert to authenticated with check (auth.uid() = staff_id);
