-- 008_task_templates_seed.sql
--
-- Seeds task_templates from the Cocoa Café task list.
-- Only inserts if no templates exist yet (safe to re-run).
-- Weekly tasks are excluded — the daily_tasks system generates tasks
-- every café day, so only Daily/All-Day tasks are seeded here.
--
-- Station values used:
--   brew_bar       → espresso machine, grinders, milk station
--   front_counter  → till, dining floor, pastry cabinet, restocking, close-out
--   cleaning       → all cleaning, wiping, sanitising tasks

DO $$
DECLARE
  owner_id uuid;
BEGIN
  -- Resolve the owner's profile ID — must exist before this migration runs
  SELECT id INTO owner_id
  FROM profiles
  WHERE role = 'owner'
  ORDER BY created_at
  LIMIT 1;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'No owner profile found. Create the owner account before seeding task templates.';
  END IF;

  -- Only seed if the table is empty (prevents duplicate seeding)
  IF EXISTS (SELECT 1 FROM task_templates LIMIT 1) THEN
    RAISE NOTICE 'task_templates already has data — skipping seed.';
    RETURN;
  END IF;

  -- ── BREW BAR ─────────────────────────────────────────────────────────────────
  -- Open tasks

  INSERT INTO task_templates (title, description, station, sort_order, is_active, created_by, created_at, updated_at) VALUES
    ('Warm up machine',         'Turn on espresso machine, run 300ml water through each group head',                    'brew_bar', 10, true, owner_id, now(), now()),
    ('Dial in house blend',     'Use calibration log to set recipe for Little Italy House Blend',                        'brew_bar', 20, true, owner_id, now(), now()),
    ('Dial in decaf',           'Dial in decaf grinder and log in calibration log',                                      'brew_bar', 30, true, owner_id, now(), now()),
    ('Purge grinders',          'Purge 2–3 shots from each grinder before serving guests',                               'brew_bar', 40, true, owner_id, now(), now()),
    ('Dial-in taste check',     'Taste test shot of house blend; adjust if needed and log',                              'brew_bar', 50, true, owner_id, now(), now()),
    ('Milk station reset',      'Refill jugs, check alt milks, wipe surfaces, purge steam wand',                         'brew_bar', 60, true, owner_id, now(), now()),
    ('Milk & alt milk check',   'Check full cream, LF, oat, soy, almond vs par; note for next delivery',                 'brew_bar', 70, true, owner_id, now(), now()),

  -- Close tasks
    ('Backflush & clean machine', 'Chemical backflush, soak portafilters, clean shower screens & trays',                 'brew_bar', 80, true, owner_id, now(), now()),
    ('Clean grinders',            'Empty hoppers, brush burrs, wipe externals, close lids',                              'brew_bar', 90, true, owner_id, now(), now());

  -- ── FRONT COUNTER ─────────────────────────────────────────────────────────────
  -- Open tasks

  INSERT INTO task_templates (title, description, station, sort_order, is_active, created_by, created_at, updated_at) VALUES
    ('Till float & POS check',  'Count float, ensure POS, printer paper and EFTPOS are working',                         'front_counter', 10, true, owner_id, now(), now()),
    ('Set up dining area',      'Chairs, tables, condiments, water station, menus clean and in place',                   'front_counter', 20, true, owner_id, now(), now()),
    ('Music & lights',          'Turn on music at appropriate volume, lights to open setting',                            'front_counter', 30, true, owner_id, now(), now()),
    ('Stock pastry cabinet',    'Stock pastries, label name & date, confirm heat times visible to staff',                 'front_counter', 40, true, owner_id, now(), now()),

  -- All day
    ('Table turn standard',     'Wipe tables & reset within 2 minutes of guest leaving',                                  'front_counter', 50, true, owner_id, now(), now()),

  -- Close tasks
    ('Cabinet top-up',          'Top up cabinet, pull any items near end of life, record waste',                          'front_counter', 60, true, owner_id, now(), now()),
    ('Clear pastry cabinet',    'Remove unsellable items, log waste, wrap usable items correctly',                        'front_counter', 70, true, owner_id, now(), now()),
    ('Restock all drinks',      NULL,                                                                                      'front_counter', 80, true, owner_id, now(), now()),
    ('Restock napkins/cutlery', NULL,                                                                                      'front_counter', 90, true, owner_id, now(), now()),
    ('Restock cakes',           NULL,                                                                                      'front_counter', 100, true, owner_id, now(), now()),
    ('Restock ice/ice cream',   NULL,                                                                                      'front_counter', 110, true, owner_id, now(), now()),
    ('Restock frozen items',    'Frozen banana, berries, etc.',                                                            'front_counter', 120, true, owner_id, now(), now()),
    ('Restock coffee beans display', NULL,                                                                                 'front_counter', 130, true, owner_id, now(), now()),
    ('Restock T/A cups/lids/straws', NULL,                                                                                 'front_counter', 140, true, owner_id, now(), now()),
    ('Charge/clean iPads & EFTPOS', NULL,                                                                                  'front_counter', 150, true, owner_id, now(), now()),
    ('Wipe down POS/keyboard',  NULL,                                                                                      'front_counter', 160, true, owner_id, now(), now()),
    ('Cashup & reports',        'Run Z-report, count cash, reconcile EFTPOS, note variances',                             'front_counter', 170, true, owner_id, now(), now()),
    ('Put cash in safe',        NULL,                                                                                      'front_counter', 180, true, owner_id, now(), now()),
    ('Shift notes',             'Record any issues, wins, maintenance needs or guest feedback',                            'front_counter', 190, true, owner_id, now(), now()),
    ('Music off',               NULL,                                                                                      'front_counter', 200, true, owner_id, now(), now()),
    ('Lights off',              NULL,                                                                                      'front_counter', 210, true, owner_id, now(), now()),
    ('Doors locked',            NULL,                                                                                      'front_counter', 220, true, owner_id, now(), now());

  -- ── CLEANING ──────────────────────────────────────────────────────────────────
  -- All close tasks

  INSERT INTO task_templates (title, description, station, sort_order, is_active, created_by, created_at, updated_at) VALUES
    ('Wipe all tables and chairs',      NULL,                                     'cleaning', 10,  true, owner_id, now(), now()),
    ('Clean table bases',               NULL,                                     'cleaning', 20,  true, owner_id, now(), now()),
    ('Clean menu stands',               NULL,                                     'cleaning', 30,  true, owner_id, now(), now()),
    ('Check & wipe S&P shakers',        NULL,                                     'cleaning', 40,  true, owner_id, now(), now()),
    ('Clean S&P trays/cabinet',         NULL,                                     'cleaning', 50,  true, owner_id, now(), now()),
    ('Clean milk fridge inside & out',  NULL,                                     'cleaning', 60,  true, owner_id, now(), now()),
    ('Clean cake cabinet',              NULL,                                     'cleaning', 70,  true, owner_id, now(), now()),
    ('Clean drink fridges',             NULL,                                     'cleaning', 80,  true, owner_id, now(), now()),
    ('Clean microwave',                 NULL,                                     'cleaning', 90,  true, owner_id, now(), now()),
    ('Clean muffin display',            NULL,                                     'cleaning', 100, true, owner_id, now(), now()),
    ('Wash blender/milkshake maker',    NULL,                                     'cleaning', 110, true, owner_id, now(), now()),
    ('Clean coffee/tea product area',   NULL,                                     'cleaning', 120, true, owner_id, now(), now()),
    ('Top up bottles/pumps',            NULL,                                     'cleaning', 130, true, owner_id, now(), now()),
    ('Clean benches/cupboards',         NULL,                                     'cleaning', 140, true, owner_id, now(), now()),
    ('Clean behind blender/milkshake',  NULL,                                     'cleaning', 150, true, owner_id, now(), now()),
    ('Clean coffee machine/grinder',    NULL,                                     'cleaning', 160, true, owner_id, now(), now()),
    ('Empty bins/replace liners',       NULL,                                     'cleaning', 170, true, owner_id, now(), now()),
    ('Vacuum/sweep FOH',                NULL,                                     'cleaning', 180, true, owner_id, now(), now()),
    ('Sweep/mop behind counter',        NULL,                                     'cleaning', 190, true, owner_id, now(), now()),
    ('Mop main floor',                  'Sweep and mop FOH & coffee area',        'cleaning', 200, true, owner_id, now(), now()),
    ('Clean sinks/benchtops/boards',    NULL,                                     'cleaning', 210, true, owner_id, now(), now()),
    ('Soak cloths in bleach',           NULL,                                     'cleaning', 220, true, owner_id, now(), now());

  RAISE NOTICE 'Task templates seeded successfully (% rows).', (SELECT count(*) FROM task_templates);
END
$$;
