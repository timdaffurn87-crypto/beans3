-- 008_task_templates_seed.sql
--
-- Seeds task_templates from the Cocoa Café task list (85 tasks total).
-- Only inserts if no templates exist yet (safe to re-run).
--
-- Daily tasks    → is_active = true  (appear on the daily checklist)
-- Weekly tasks   → is_active = false (stored for reference; recurrence day
--                  is noted in description; activate via /admin/tasks)
--
-- Station values:
--   brew_bar       → espresso machine, grinders, milk station
--   front_counter  → till, dining floor, pastry cabinet, restocking, close-out
--   cleaning       → all cleaning, wiping, sanitising tasks

DO $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT id INTO owner_id
  FROM profiles
  WHERE role = 'owner'
  ORDER BY created_at
  LIMIT 1;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'No owner profile found. Create the owner account before seeding task templates.';
  END IF;

  IF EXISTS (SELECT 1 FROM task_templates LIMIT 1) THEN
    RAISE NOTICE 'task_templates already has data — skipping seed.';
    RETURN;
  END IF;

  -- ── BREW BAR ──────────────────────────────────────────────────────────────────

  INSERT INTO task_templates (title, description, station, sort_order, is_active, created_by, created_at, updated_at) VALUES
    -- Open (daily)
    ('Warm up machine (barista)',    'Barista warm-up: turn on espresso machine, run 300ml water through each group head',        'brew_bar',  5,   true,  owner_id, now(), now()),
    ('Warm up machine',              'Turn on espresso machine, run 300ml water through each group head',                          'brew_bar',  10,  true,  owner_id, now(), now()),
    ('Dial in house blend',          'Use calibration log to set recipe for Little Italy House Blend',                             'brew_bar',  20,  true,  owner_id, now(), now()),
    ('Dial in decaf',                'Dial in decaf grinder and log in calibration log',                                           'brew_bar',  30,  true,  owner_id, now(), now()),
    ('Purge grinders',               'Purge 2–3 shots from each grinder before serving guests',                                    'brew_bar',  40,  true,  owner_id, now(), now()),
    ('Dial-in taste check',          'Taste test shot of house blend; adjust if needed and log',                                   'brew_bar',  50,  true,  owner_id, now(), now()),
    ('Milk station reset',           'Refill jugs, check alt milks, wipe surfaces, purge steam wand',                              'brew_bar',  60,  true,  owner_id, now(), now()),
    ('Milk & alt milk check',        'Check full cream, LF, oat, soy, almond vs par; note for next delivery',                      'brew_bar',  70,  true,  owner_id, now(), now()),
    -- Close (daily)
    ('Backflush & clean machine',    'Chemical backflush, soak portafilters, clean shower screens & trays',                        'brew_bar',  80,  true,  owner_id, now(), now()),
    ('Chemical clean group heads',   'Backflush chemical clean group heads',                                                       'brew_bar',  85,  true,  owner_id, now(), now()),
    ('Clean grinders',               'Empty hoppers, brush burrs, wipe externals, close lids',                                    'brew_bar',  90,  true,  owner_id, now(), now()),
    -- Weekly (inactive)
    ('Grinder deep clean – house',   'Empty hopper, vacuum & brush burrs, wipe externals, reset dose & dial in · Weekly: Monday', 'brew_bar',  95,  false, owner_id, now(), now()),
    ('Grinder deep clean – decaf',   'Same as house grinder deep clean · Weekly: Monday',                                         'brew_bar',  100, false, owner_id, now(), now());

  -- ── FRONT COUNTER ─────────────────────────────────────────────────────────────

  INSERT INTO task_templates (title, description, station, sort_order, is_active, created_by, created_at, updated_at) VALUES
    -- Open (daily)
    ('Till float & POS check',       'Count float, ensure POS, printer paper and EFTPOS are working',                             'front_counter', 10,  true,  owner_id, now(), now()),
    ('Set up dining area',           'Chairs, tables, condiments, water station, menus clean and in place',                       'front_counter', 20,  true,  owner_id, now(), now()),
    ('Music & lights',               'Turn on music at appropriate volume, lights to open setting',                                'front_counter', 30,  true,  owner_id, now(), now()),
    ('Stock pastry cabinet',         'Stock pastries, label name & date, confirm heat times visible to staff',                    'front_counter', 40,  true,  owner_id, now(), now()),
    -- All day (daily)
    ('Table turn standard',          'Wipe tables & reset within 2 minutes of guest leaving',                                     'front_counter', 50,  true,  owner_id, now(), now()),
    -- Close (daily)
    ('Cabinet top-up',               'Top up cabinet, pull any items near end of life, record waste',                             'front_counter', 60,  true,  owner_id, now(), now()),
    ('Clear pastry cabinet',         'Remove unsellable items, log waste, wrap usable items correctly',                           'front_counter', 70,  true,  owner_id, now(), now()),
    ('Restock all drinks',           NULL,                                                                                         'front_counter', 80,  true,  owner_id, now(), now()),
    ('Restock napkins/cutlery',      NULL,                                                                                         'front_counter', 90,  true,  owner_id, now(), now()),
    ('Restock cakes',                NULL,                                                                                         'front_counter', 100, true,  owner_id, now(), now()),
    ('Restock ice/ice cream',        NULL,                                                                                         'front_counter', 110, true,  owner_id, now(), now()),
    ('Restock frozen items',         'Frozen banana, berries, etc.',                                                               'front_counter', 120, true,  owner_id, now(), now()),
    ('Restock coffee beans display', NULL,                                                                                         'front_counter', 130, true,  owner_id, now(), now()),
    ('Restock T/A cups/lids/straws', NULL,                                                                                         'front_counter', 140, true,  owner_id, now(), now()),
    ('Charge/clean iPads & EFTPOS',  NULL,                                                                                         'front_counter', 150, true,  owner_id, now(), now()),
    ('Wipe down POS/keyboard',       NULL,                                                                                         'front_counter', 160, true,  owner_id, now(), now()),
    ('Cashup & reports',             'Run Z-report, count cash, reconcile EFTPOS, note variances',                                'front_counter', 170, true,  owner_id, now(), now()),
    ('Put cash in safe',             NULL,                                                                                         'front_counter', 180, true,  owner_id, now(), now()),
    ('Shift notes',                  'Record any issues, wins, maintenance needs or guest feedback',                               'front_counter', 190, true,  owner_id, now(), now()),
    ('Music off',                    NULL,                                                                                         'front_counter', 200, true,  owner_id, now(), now()),
    ('Lights off',                   NULL,                                                                                         'front_counter', 210, true,  owner_id, now(), now()),
    ('Doors locked',                 NULL,                                                                                         'front_counter', 220, true,  owner_id, now(), now()),
    ('Floors & bins',                'Sweep and mop FOH & coffee area, empty all bins, new liners',                               'front_counter', 225, true,  owner_id, now(), now()),
    -- Weekly (inactive)
    ('Beans stocktake & order',      'Count Little Italy house & decaf, compare to par, place order if needed · Weekly: Monday',  'front_counter', 230, false, owner_id, now(), now()),
    ('Menu & specials review',       'Review sales, feedback, and COGS for any specials; adjust if needed · Weekly: Sunday',      'front_counter', 235, false, owner_id, now(), now()),
    ('Cabinet strip & clean',        'Empty cabinet, full clean of glass, shelves, runners, light fittings · Weekly: Thursday',   'front_counter', 240, false, owner_id, now(), now()),
    ('Small maintenance check',      'Check wobbly tables, lights, chairs, doors, note anything for repair · Weekly: Sunday',     'front_counter', 245, false, owner_id, now(), now()),
    ('Coffee training & cupping',    'Taste house & decaf; review recipe, milk texturing, latte art basics · Weekly: Friday',     'front_counter', 250, false, owner_id, now(), now()),
    ('Service standards refresh',    '5–10min huddle on greetings, table checks, upsell lines · Weekly: Friday',                  'front_counter', 255, false, owner_id, now(), now());

  -- ── CLEANING ──────────────────────────────────────────────────────────────────

  INSERT INTO task_templates (title, description, station, sort_order, is_active, created_by, created_at, updated_at) VALUES
    -- Close (daily)
    ('Wipe all tables and chairs',      NULL,                                                'cleaning', 10,  true,  owner_id, now(), now()),
    ('Clean table bases',               NULL,                                                'cleaning', 20,  true,  owner_id, now(), now()),
    ('Clean menu stands',               NULL,                                                'cleaning', 30,  true,  owner_id, now(), now()),
    ('Check & wipe S&P shakers',        NULL,                                                'cleaning', 40,  true,  owner_id, now(), now()),
    ('Clean S&P trays/cabinet',         NULL,                                                'cleaning', 50,  true,  owner_id, now(), now()),
    ('Clean milk fridge inside & out',  NULL,                                                'cleaning', 60,  true,  owner_id, now(), now()),
    ('Clean cake cabinet',              NULL,                                                'cleaning', 70,  true,  owner_id, now(), now()),
    ('Clean drink fridges',             NULL,                                                'cleaning', 80,  true,  owner_id, now(), now()),
    ('Clean microwave',                 NULL,                                                'cleaning', 90,  true,  owner_id, now(), now()),
    ('Clean muffin display',            NULL,                                                'cleaning', 100, true,  owner_id, now(), now()),
    ('Wash blender/milkshake maker',    NULL,                                                'cleaning', 110, true,  owner_id, now(), now()),
    ('Clean coffee/tea product area',   NULL,                                                'cleaning', 120, true,  owner_id, now(), now()),
    ('Top up bottles/pumps',            NULL,                                                'cleaning', 130, true,  owner_id, now(), now()),
    ('Clean benches/cupboards',         NULL,                                                'cleaning', 140, true,  owner_id, now(), now()),
    ('Clean behind blender/milkshake',  NULL,                                                'cleaning', 150, true,  owner_id, now(), now()),
    ('Clean coffee machine/grinder',    NULL,                                                'cleaning', 160, true,  owner_id, now(), now()),
    ('Empty bins/replace liners',       NULL,                                                'cleaning', 170, true,  owner_id, now(), now()),
    ('Vacuum/sweep FOH',                NULL,                                                'cleaning', 180, true,  owner_id, now(), now()),
    ('Sweep/mop behind counter',        NULL,                                                'cleaning', 190, true,  owner_id, now(), now()),
    ('Mop main floor',                  'Sweep and mop FOH & coffee area',                  'cleaning', 200, true,  owner_id, now(), now()),
    ('Clean sinks/benchtops/boards',    NULL,                                                'cleaning', 210, true,  owner_id, now(), now()),
    ('Soak cloths in bleach',           NULL,                                                'cleaning', 220, true,  owner_id, now(), now()),
    -- Weekly (inactive)
    ('Wash water dispenser',            'Disassemble, wash & reassemble · Weekly: Monday',          'cleaning', 225, false, owner_id, now(), now()),
    ('Wash cutlery tray',               'Wash and sanitise trays · Weekly: Sunday',                 'cleaning', 230, false, owner_id, now(), now()),
    ('Wipe all chairs (frames/legs)',   'Wipe frames and legs · Weekly: Tuesday',                   'cleaning', 235, false, owner_id, now(), now()),
    ('Deep clean coffee machine top',   'Deep clean top surface · Weekly: Monday',                  'cleaning', 240, false, owner_id, now(), now()),
    ('Deep clean grinder',              'Deep clean hopper & burr area · Weekly: Sunday & Wednesday', 'cleaning', 245, false, owner_id, now(), now()),
    ('Clean/defrost freezer',           'Defrost, empty & wipe · Weekly: Wednesday',                'cleaning', 250, false, owner_id, now(), now()),
    ('Clean front barriers',            'Wipe barrier surfaces · Weekly: Monday',                   'cleaning', 255, false, owner_id, now(), now()),
    ('Wipe open shelving',              'Dust and wipe shelves · Weekly: Monday',                   'cleaning', 260, false, owner_id, now(), now()),
    ('Clean cake cabinet tracks',       'Strip shelves and clean tracks · Weekly: Tuesday',         'cleaning', 265, false, owner_id, now(), now()),
    ('Dust/wipe display shelves',       'Dust and polish shelves · Weekly: Wednesday',              'cleaning', 270, false, owner_id, now(), now()),
    ('Dust walls/timber',               'Dust walls and timber · Weekly: Friday',                   'cleaning', 275, false, owner_id, now(), now()),
    ('Wipe/dust black surfaces',        'Wipe all black surfaces · Weekly: Monday',                 'cleaning', 280, false, owner_id, now(), now()),
    ('Sweep pylons/windows',            'Sweep between pylons and windows · Weekly: Thursday',      'cleaning', 285, false, owner_id, now(), now()),
    ('Mop under milk fridge',           'Mop floor underneath fridge · Weekly: Monday',             'cleaning', 290, false, owner_id, now(), now()),
    ('Deep clean teapots',              'Soak scrub and rinse · Weekly: Friday',                    'cleaning', 295, false, owner_id, now(), now()),
    ('Clean choc/chai/mallow area',     'Wipe jars and area · Weekly: Tuesday',                     'cleaning', 300, false, owner_id, now(), now()),
    ('Wash syrup pumps',                'Strip soak and wash · Weekly: Tuesday',                    'cleaning', 305, false, owner_id, now(), now()),
    ('Clean fridge seals',              'Brush and wipe seals · Weekly: Monday',                    'cleaning', 310, false, owner_id, now(), now()),
    ('Clean inside fridges',            'Remove product and wipe interior · Weekly: Wednesday',     'cleaning', 315, false, owner_id, now(), now()),
    ('Soak additional items',           'Soak extra utensils/items · Weekly: Tuesday',              'cleaning', 320, false, owner_id, now(), now()),
    ('Salt & pepper clean',             'Weekly: Friday',                                           'cleaning', 325, false, owner_id, now(), now());

  RAISE NOTICE 'Task templates seeded successfully (% rows).', (SELECT count(*) FROM task_templates);
END
$$;
