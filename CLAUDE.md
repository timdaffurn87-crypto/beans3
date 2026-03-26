# BEANS v2 — FOH Operations App for Cocoa Café

## What This Is

Beans is a mobile-first Progressive Web App (PWA) for front-of-house café staff at Cocoa Café. Staff use it on their phones during shifts to capture operational data — coffee calibration, waste logging, task completion, invoice scanning, and end-of-day reporting. All data feeds into **Krema** (the owner's AI command dashboard) and **Grind** (cost analysis agent) as part of the larger **CaféOS** ecosystem.

## Who Built This & Why

Tim owns Cocoa Café in Coffs Harbour, Australia. He's not a developer — he directs AI to build. Keep code clean, well-commented, and structured so AI tools can maintain it later. Prefer simplicity over cleverness. If something can be done with fewer dependencies, do it that way.

## Tech Stack

- **Framework**: Next.js 14+ (App Router) with TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL + Auth + Realtime + Storage)
- **Hosting**: Vercel
- **PWA**: next-pwa or @ducanh2912/next-pwa for service worker / installability
- **AI**: Anthropic Claude API for invoice OCR extraction (API key stored in settings, entered by owner)
- **Email**: Resend or Supabase Edge Function for EOD report emails to owner

## Core Concept: The Café Day

The app does NOT operate on calendar days. It operates on a **café day** that runs from **5:30 AM to 3:00 PM** by default. All data — tasks, waste, calibrations, invoices, EOD reports — groups by café day, not by midnight-to-midnight. The café day start/end times are configurable in Settings.

When determining "today" in any query or display, use the café day window. A waste log at 5:45 AM belongs to that day's café day. The café day resets at the configured start time the next morning.

## Design Language

Reference the mockup images in `/designs/` folder. The visual identity is:

- **Background**: Warm cream / off-white (#FAF8F3 or similar)
- **Primary accent**: Dark gold / copper (#B8960C or similar)
- **Cards**: White with subtle rounded corners (16px radius), light shadow
- **Dark elements**: Near-black (#1A1A1A) for dark cards and critical alerts
- **CRITICAL ALERT**: Bright red (#DC2626) for calibration overdue — this must be impossible to miss
- **Success/Complete**: Green (#16A34A) for completed items, calibration OK
- **Warning**: Amber (#D97706) for approaching thresholds
- **Typography**: Clean sans-serif, uppercase letter-spaced labels for section headers (e.g. "OPERATIONS", "RECENT ACTIVITY"), bold headings
- **Navigation**: Bottom tab bar. Active tab has filled/highlighted icon with label
- **Buttons**: Gold/copper rounded pill buttons for primary actions
- **Tone**: Operational, professional, fast. Not a consumer app. Think POS system meets clean productivity tool.
- **Mobile-first**: Designed for phone screens used during shifts. Touch targets must be large (min 44px). No tiny buttons.

## Roles & Permissions

Three roles. No supervisor tier. The app shows/hides screens and navigation based on role.

### Barista
- **Can access**: Dashboard, Coffee Calibration, Waste Logging, Tasks (complete only), Invoice Scanning, Recipes (view only), End of Day
- **Cannot access**: Menu Management, 7-Day Results, Settings, Task template editing, Recipe editing

### Manager
- Everything baristas can do, PLUS:
- **Tasks**: Create, edit, delete task templates
- **Recipes**: Full CRUD (create, read, update, delete)
- **7-Day Results**: View rolling performance data with drill-down
- **Settings link visible** but limited (cannot edit API keys or owner email)

### Owner (Tim)
- Everything managers can do, PLUS:
- **Settings**: Full access — manage staff PINs/roles, set owner email, enter API keys, configure café day times
- **Targets & KPIs**: Set performance targets inside 7-Day Results
- **Menu Management**: Full access to add/edit/delete menu items and pricing

---

## App Screens & Features

### 1. PIN Login (`/login`)
- Clean entry screen. No email, no Google sign-in. PIN only.
- Large number pad (phone lock screen style) for 4–6 digit PIN entry
- On valid PIN: look up staff profile, determine role, redirect to Dashboard
- On invalid PIN: shake animation, "Invalid PIN" message, clear input
- Each staff member has a unique PIN set by the owner in Settings
- Session persists until browser is closed or staff taps "Log Out" from Dashboard
- No "forgot PIN" flow — owner resets PINs in Settings
- If no staff exist yet (first launch), show a one-time setup screen to create the owner account with a PIN

### 2. Dashboard (`/`) — All roles
- **Greeting**: "Good morning, [Name]." with today's date (café day date)
- **Calibration Alert** (TOP PRIORITY ELEMENT):
  - If coffee has NOT been calibrated within the last 60 minutes: show a LARGE RED banner/card that says "CALIBRATION OVERDUE" with a tap-to-calibrate button. This is the single most prominent element on the screen. It should be visually impossible to ignore — red background, bold text, maybe a pulse/glow animation.
  - If calibrated within the last 60 minutes: show a small green "Calibrated ✓" badge with timestamp of last calibration
- **Summary cards**:
  - Today's Tasks: "7 of 12 done" with progress bar
  - Today's Waste: "$34.50" running total for the café day
- **Quick-tap buttons**: Large cards linking to each feature — Calibration, Waste, Tasks, Invoices, Recipes, End of Day
- **Manager/Owner extras**: Additional links for "7-Day Results" and "Settings" (only visible to those roles)
- **Log Out** button (top right or in a minimal profile dropdown)

### 3. Coffee Calibration (`/calibration`) — All roles
- Header: "Coffee Calibration" with "Dial-In Log" subtitle
- Form fields:
  - **Grinder Setting**: number input (e.g. 3.5) — the grind size dial number
  - **Dose**: number input in grams (e.g. 22.0g)
  - **Yield**: number input in grams (e.g. 36.0g)
  - **Time**: number input in seconds (e.g. 28s) — extraction time
  - **Notes**: optional text field (e.g. "Pulled slightly sour, adjusted 0.5 finer")
- **Submit** button — saves to `calibrations` table, clears the red dashboard alert for the next 60 minutes
- **Today's Calibration History**: list below the form showing all calibrations logged today (café day) with time, who logged it, and the settings
- Ratio auto-calculated and displayed: Dose:Yield ratio (e.g. "1:1.6")

### 4. Waste Logging (`/waste`) — All roles
- Header: "Waste Logger"
- Form fields:
  - **Menu Item**: searchable dropdown populated from the `menu_items` table. Shows item name and sell price. This is NOT a free-text field — staff pick from the menu.
  - **Quantity**: number input (how many units wasted, e.g. 2 coffees, 3 croissants)
  - **Reason**: dropdown (Expired, Spilled, Overproduction, Damaged, Quality Issue, Dropped, Wrong Order, Customer Return)
  - **Notes**: optional text field
- **Estimated Loss**: auto-calculated as quantity × item cost price (from menu_items table). Displayed prominently.
- **Submit Entry** button
- **Today's Waste Log**: list of all waste entries for the current café day, showing item, quantity, cost, reason, who logged it, time. Running total at top.

### 5. Tasks (`/tasks`) — All roles complete, Manager/Owner manage templates
- Header: "Daily Tasks"
- Checklist of today's tasks auto-generated from task templates at the start of each café day
- Each task shows: checkbox, task name, description (if any), station
- Completing a task: tap checkbox → records who completed it and timestamp
- Completed tasks show: green check, staff name, time
- Progress indicator: "7 of 12 complete" at the top
- Tasks grouped by station (e.g. "Brew Bar", "Kitchen", "Front Counter", "Cleaning")
- **Manager/Owner**: see a "Manage Templates" button (gear icon or link) that goes to `/admin/tasks`
  - Template editor: list all task templates, grouped by station
  - Add new task: title, description (optional), station (dropdown), sort order
  - Edit existing task: inline edit
  - Delete task: with confirmation
  - Changes to templates take effect on the NEXT café day (don't disrupt today's list)

### 6. Invoice Scanning (`/invoice`) — All roles
- Header: "Scan Invoice"
- **Camera capture area**: large button to open phone camera and photograph an invoice
- After photo is taken:
  - Photo preview shown
  - "Extract with AI" button — sends photo to Claude API (Anthropic) for OCR extraction
  - Loading state while AI processes
  - AI returns: supplier name, invoice date, reference number, line items (description, quantity, unit price, total), invoice total
  - Extracted data displayed in a clean card layout for review
  - Staff can edit any extracted field if AI got it wrong
  - "Save Invoice" button — saves to `invoices` table with status 'pending'
- **Today's Invoices**: list of all invoices scanned today (café day). These are held locally until End of Day submit.
- If Claude API key is not configured in Settings: show a message "Invoice AI extraction not configured — ask your manager" and allow manual entry only (all fields typed by hand)

### 7. Recipes (`/recipes`) — All roles view, Manager/Owner edit
- Header: "Recipe Book"
- Searchable list of all recipes
- Each recipe card shows: name, category (e.g. Coffee, Food, Beverage), optional photo
- Tap to open full recipe detail:
  - Recipe name
  - Category
  - Ingredients list with quantities
  - Method/steps (numbered)
  - Notes (e.g. "Use oat milk for oat latte variant")
  - Photo (optional)
- **Manager/Owner**: see "Add Recipe" button and "Edit" button on each recipe
  - Recipe form: name, category (dropdown), ingredients (repeating fields: ingredient name + quantity + unit), method (rich-ish text or numbered steps), notes, photo upload
  - Delete recipe with confirmation

### 8. Menu Management (`/admin/menu`) — Manager/Owner only
- Header: "Menu Items"
- List of all menu items with: name, category, sell price, cost price
- **Add item**: two methods:
  - **Photo capture**: photograph the physical menu board → Claude AI extracts item names and prices → review and confirm → saves to `menu_items` table
  - **Manual entry**: name, category (Coffee, Food, Beverage, Retail), sell price, cost price
- **Edit item**: tap to edit any field
- **Delete item**: swipe or delete button with confirmation
- These items power the Waste Logging dropdown picker
- Cost price is used to calculate waste value
- If Claude API key not configured: photo extraction unavailable, manual entry only

### 9. End of Day (`/eod`) — All roles
- Header: "End of Day Report"
- Auto-generated summary of the current café day:
  - **Tasks**: X of Y completed. List of incomplete tasks highlighted.
  - **Waste**: Total dollar value. Top 3 waste items by cost.
  - **Calibration Compliance**: How many calibrations were logged today. Were there any gaps longer than 60 minutes? Show as % compliance (e.g. "92% — 1 gap detected at 11:15 AM").
  - **Invoices**: Count of invoices scanned today. Total value. List of suppliers.
- **Notes**: optional text field for anything the staff wants to flag
- **"Submit & Close Day"** button:
  - Saves the EOD report to `eod_reports` table
  - Emails the full report to the owner email configured in Settings
  - Email includes: the summary above + all invoice photos/data as attachments or inline
  - After submit: shows a confirmation screen, then returns to PIN Login (shift is over)
- Staff cannot submit EOD twice for the same café day
- If tasks are incomplete, show a warning: "You have X incomplete tasks. Submit anyway?" — allow override

### 10. 7-Day Results (`/results`) — Manager/Owner only
- Header: "7-Day Performance"
- Rolling 7-day view showing one row/card per café day
- Each day shows:
  - Date
  - Task completion % (colour-coded: green ≥90%, amber 70-89%, red <70%)
  - Total waste $ (colour-coded against target if set)
  - Calibration compliance % (colour-coded: green = 100%, amber ≥80%, red <80%)
  - Invoice count
- Tap any day → drill into the full EOD report for that day
- **Targets & KPIs** section (Owner only can edit, Manager can view):
  - Set targets: daily waste limit ($), task completion target (%), calibration compliance target (%)
  - Targets stored in `settings` table
  - Each day's colour coding is based on these targets
  - Default targets if none set: waste <$50, tasks ≥90%, calibration 100%

### 11. Settings (`/admin/settings`) — Manager/Owner (partial), Owner (full)
- **Staff Management** (Owner only):
  - List of all staff: name, role, PIN (masked), active/inactive
  - Add new staff: name, role (barista/manager), generate or set PIN
  - Edit staff: change name, role, PIN, activate/deactivate
  - Cannot delete staff (data integrity) — only deactivate
  - Owner's own PIN can be changed but role cannot be changed
- **Café Configuration** (Owner only):
  - Owner email address (for EOD report emails)
  - Café day start time (default 5:30 AM)
  - Café day end time (default 3:00 PM)
- **API Keys** (Owner only):
  - Claude API key (for invoice scanning and menu photo extraction). Stored securely. Masked after entry.
  - Xero API key (placeholder field — shows "Coming soon" label, not functional yet)
- **Targets** (Owner only):
  - Same as in 7-Day Results — daily waste target, task completion target, calibration compliance target

---

## Database Schema (Supabase)

### `profiles`
- id (uuid, PK)
- full_name (text)
- role (text: 'barista', 'manager', 'owner')
- pin (text, 4-6 digits, unique)
- is_active (boolean, default true)
- created_at (timestamptz)

### `calibrations`
- id (uuid, PK)
- staff_id (uuid, FK to profiles)
- grinder_setting (numeric)
- dose_grams (numeric)
- yield_grams (numeric)
- time_seconds (numeric)
- ratio (numeric, auto-calculated: yield / dose)
- notes (text, nullable)
- cafe_day (date)
- created_at (timestamptz)

### `menu_items`
- id (uuid, PK)
- name (text)
- category (text: 'coffee', 'food', 'beverage', 'retail')
- sell_price (numeric)
- cost_price (numeric)
- is_active (boolean, default true)
- created_at (timestamptz)
- updated_at (timestamptz)

### `waste_logs`
- id (uuid, PK)
- staff_id (uuid, FK to profiles)
- menu_item_id (uuid, FK to menu_items)
- item_name (text — denormalized for historical accuracy if menu item is later edited)
- quantity (numeric)
- unit_cost (numeric — cost_price at time of logging)
- total_cost (numeric — quantity × unit_cost)
- reason (text)
- notes (text, nullable)
- cafe_day (date)
- created_at (timestamptz)

### `task_templates`
- id (uuid, PK)
- title (text)
- description (text, nullable)
- station (text: e.g. 'brew_bar', 'kitchen', 'front_counter', 'cleaning')
- sort_order (integer)
- is_active (boolean, default true)
- created_by (uuid, FK to profiles)
- created_at (timestamptz)
- updated_at (timestamptz)

### `daily_tasks`
- id (uuid, PK)
- template_id (uuid, FK to task_templates)
- cafe_day (date)
- title (text — copied from template at generation time)
- description (text, nullable)
- station (text)
- completed_by (uuid, FK to profiles, nullable)
- completed_at (timestamptz, nullable)
- created_at (timestamptz)

Note: daily_tasks are auto-generated from active task_templates at the start of each café day (first login of the day triggers generation, or a scheduled Supabase Edge Function).

### `invoices`
- id (uuid, PK)
- scanned_by (uuid, FK to profiles)
- supplier_name (text)
- invoice_date (date, nullable)
- reference_number (text, nullable)
- total_amount (numeric)
- line_items (jsonb — array of {description, quantity, unit_price, total})
- photo_url (text — Supabase Storage path)
- ai_confidence (text: 'high', 'medium', 'low', nullable — null if manual entry)
- status (text: 'pending', 'submitted' — pending until EOD submit)
- cafe_day (date)
- created_at (timestamptz)

### `recipes`
- id (uuid, PK)
- name (text)
- category (text: 'coffee', 'food', 'beverage')
- ingredients (jsonb — array of {name, quantity, unit})
- method (jsonb — array of strings, one per step)
- notes (text, nullable)
- photo_url (text, nullable — Supabase Storage path)
- created_by (uuid, FK to profiles)
- created_at (timestamptz)
- updated_at (timestamptz)

### `eod_reports`
- id (uuid, PK)
- submitted_by (uuid, FK to profiles)
- cafe_day (date, unique)
- tasks_completed (integer)
- tasks_total (integer)
- waste_total_value (numeric)
- waste_top_items (jsonb — array of {item_name, total_cost, quantity})
- calibration_count (integer)
- calibration_compliance_pct (numeric)
- calibration_gaps (jsonb, nullable — array of {gap_start, gap_end, duration_minutes})
- invoices_count (integer)
- invoices_total_value (numeric)
- invoice_ids (uuid[], FK references to invoices)
- notes (text, nullable)
- created_at (timestamptz)

### `settings`
- id (uuid, PK)
- key (text, unique)
- value (text)
- updated_at (timestamptz)

Settings keys:
- `owner_email` — email address for EOD reports
- `cafe_day_start` — time string e.g. "05:30"
- `cafe_day_end` — time string e.g. "15:00"
- `claude_api_key` — encrypted/masked Anthropic API key
- `xero_api_key` — placeholder, not functional yet
- `target_daily_waste` — numeric string e.g. "50.00"
- `target_task_completion` — numeric string e.g. "90"
- `target_calibration_compliance` — numeric string e.g. "100"

### `activity_log`
- id (uuid, PK)
- staff_id (uuid, FK to profiles)
- action_type (text: 'calibration_logged', 'waste_logged', 'task_completed', 'invoice_scanned', 'eod_submitted', 'recipe_created', 'recipe_updated', 'menu_item_added', 'task_template_created', 'staff_added', 'settings_updated')
- description (text)
- amount (numeric, nullable)
- cafe_day (date)
- created_at (timestamptz)

---

## Authentication: PIN-Based Login via Supabase Auth

Beans uses PIN-based login, NOT email/password from the user's perspective. Under the hood, we use Supabase Auth with auto-generated dummy emails to get proper RLS support:

- When owner creates a staff member (name + role + PIN), the app creates a Supabase Auth user with email `pin{PIN}@beans.local` and password = the PIN
- On PIN login, the app calls `supabase.auth.signInWithPassword({ email: 'pin{PIN}@beans.local', password: PIN })`
- This gives us a proper auth session with `auth.uid()` for RLS
- The `profiles` table links to `auth.users` via the id field
- Staff never see emails — they only interact with the PIN pad

This approach gives us Supabase RLS for free without making staff deal with email addresses.

---

## Row-Level Security (Supabase RLS)

- `profiles`: all authenticated can SELECT. Only owner role can UPDATE other users. Users can update their own name.
- `calibrations`: all authenticated can INSERT and SELECT. No UPDATE/DELETE needed.
- `menu_items`: all authenticated can SELECT. Only manager/owner can INSERT/UPDATE/DELETE.
- `waste_logs`: all authenticated can INSERT and SELECT. No UPDATE/DELETE (audit trail).
- `task_templates`: all authenticated can SELECT. Only manager/owner can INSERT/UPDATE/DELETE.
- `daily_tasks`: all authenticated can SELECT and UPDATE (to mark complete). Auto-generated, no manual INSERT from app.
- `invoices`: all authenticated can INSERT and SELECT. No UPDATE except status field on EOD submit.
- `recipes`: all authenticated can SELECT. Only manager/owner can INSERT/UPDATE/DELETE.
- `eod_reports`: all authenticated can INSERT (one per café day). All can SELECT.
- `settings`: all authenticated can SELECT non-sensitive keys. Only owner can INSERT/UPDATE. Claude API key only readable server-side.
- `activity_log`: all authenticated can INSERT and SELECT. No UPDATE/DELETE.

---

## PWA Requirements

- Installable on iOS Safari and Android Chrome
- Offline-capable: queue form submissions when offline, sync when back online
- App icon: Beans logo (placeholder coffee bean icon for now)
- Splash screen: cream background with "BEANS" wordmark
- Manifest: display: standalone, theme_color: #FAF8F3, background_color: #FAF8F3

---

## Build Order

### Phase 1 — Foundation
1. **Project scaffold**: Next.js + Tailwind + Supabase client + PWA config
2. **PIN Login**: PIN pad UI, Supabase Auth with dummy emails, role-based redirect
3. **Settings — Staff Management (owner)**: Add staff with PIN/role — build this early so you can create test accounts
4. **Dashboard**: Layout with greeting, calibration alert (static/mock first), summary cards, quick-tap buttons, role-based navigation

### Phase 2 — Core Data Capture
5. **Menu Management**: Manual item entry first (photo AI extraction is Phase 4). Build this before Waste so the dropdown has data.
6. **Coffee Calibration**: Form + Supabase insert + dashboard alert logic (query last calibration, check if >60 min ago)
7. **Waste Logging**: Form with menu item dropdown, auto-cost calculation, submit + today's log
8. **Tasks**: Auto-generate daily_tasks from templates at café day start. Checklist completion UI. Template editor for managers/owners.

### Phase 3 — Invoices & EOD
9. **Invoice Scanning (manual first)**: Photo capture via phone camera + Supabase Storage upload + manual entry of all fields
10. **End of Day**: Auto-generated summary from café day data. Submit saves report + emails owner. Returns to PIN login.

### Phase 4 — AI & Recipes
11. **Invoice AI Extraction**: Wire up Claude API — send photo, receive structured data, populate form for review. Graceful fallback if no API key.
12. **Menu photo extraction**: Claude AI reads menu board photos to auto-populate menu items
13. **Recipes**: Browse/search/view for all. CRUD for managers/owners. Photo upload to Supabase Storage.

### Phase 5 — Reporting & Polish
14. **7-Day Results**: Rolling performance view with colour coding against targets. Drill-down to EOD reports. Owner target/KPI configuration.
15. **Settings — full build**: Café config (email, café day times), API key entry, targets
16. **PWA polish**: Service worker, offline queue, install prompt
17. **Activity log**: Wire up logging across all actions
18. **Edge cases**: duplicate EOD prevention, café day boundary logic, empty states, first-launch onboarding

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key (server-side only, for creating auth users)
```

Note: The Claude API key is NOT an env variable — it's stored in the `settings` table and entered by the owner through the app UI. This way Tim can update it without redeploying.

---

## Folder Structure

```
beans/
├── CLAUDE.md                ← this file
├── designs/                 ← Stitch mockup screenshots
│   ├── 01-dashboard.png
│   ├── 02-invoice-scanner.png
│   ├── 03-task-checklist.png
│   ├── 04-till-reconciliation.png  (v1 reference — till removed in v2)
│   └── 05-waste-logger.png
├── public/
│   ├── manifest.json
│   └── icons/
├── src/
│   ├── app/
│   │   ├── layout.tsx       ← root layout with role-based bottom nav
│   │   ├── page.tsx         ← dashboard (redirects to /login if not authed)
│   │   ├── login/
│   │   │   └── page.tsx     ← PIN login screen
│   │   ├── calibration/
│   │   │   └── page.tsx
│   │   ├── waste/
│   │   │   └── page.tsx
│   │   ├── tasks/
│   │   │   └── page.tsx
│   │   ├── invoice/
│   │   │   └── page.tsx
│   │   ├── recipes/
│   │   │   ├── page.tsx     ← recipe list
│   │   │   └── [id]/
│   │   │       └── page.tsx ← recipe detail
│   │   ├── eod/
│   │   │   └── page.tsx     ← end of day report + submit
│   │   ├── results/
│   │   │   └── page.tsx     ← 7-day results (manager/owner)
│   │   └── admin/
│   │       ├── menu/
│   │       │   └── page.tsx ← menu management (manager/owner)
│   │       ├── tasks/
│   │       │   └── page.tsx ← task template editor (manager/owner)
│   │       └── settings/
│   │           └── page.tsx ← staff mgmt + café config + API keys (owner)
│   ├── components/
│   │   ├── ui/              ← reusable (Button, Card, Input, Select, PinPad, Toast, etc.)
│   │   ├── BottomNav.tsx    ← role-aware bottom navigation
│   │   ├── CalibrationAlert.tsx ← red/green dashboard banner
│   │   ├── DashboardCard.tsx
│   │   ├── WasteLogList.tsx
│   │   ├── TaskItem.tsx
│   │   ├── InvoiceCard.tsx
│   │   ├── RecipeCard.tsx
│   │   ├── EODSummary.tsx
│   │   └── ResultsDayCard.tsx
│   ├── lib/
│   │   ├── supabase.ts      ← Supabase client init (browser)
│   │   ├── supabase-server.ts ← Supabase server client (service role, for auth user creation)
│   │   ├── types.ts          ← TypeScript types matching DB schema
│   │   ├── cafe-day.ts       ← getCurrentCafeDay(), isCafeDayActive(), getCafeDayBounds()
│   │   ├── auth.ts           ← PIN login/logout helpers, session management
│   │   └── utils.ts          ← formatCurrency, getGreeting, calculateRatio, etc.
│   ├── hooks/
│   │   ├── useAuth.ts        ← current user, role, login state
│   │   ├── useCalibration.ts ← last calibration time, isOverdue boolean
│   │   ├── useCafeDay.ts     ← current café day date and time boundaries
│   │   └── useRole.ts        ← isBarista, isManager, isOwner helpers
│   └── middleware.ts          ← protect routes: redirect to /login if no session, block admin routes by role
├── supabase/
│   └── migrations/            ← SQL migration files for full schema + RLS policies
├── tailwind.config.ts
├── next.config.js
└── package.json
```

---

## Bottom Navigation

The bottom nav adapts based on role:

### Barista (5 primary tabs)
Dashboard | Calibrate | Waste | Tasks | More (→ Invoice, Recipes, EOD)

### Manager / Owner (5 primary tabs)
Dashboard | Calibrate | Waste | Tasks | More (→ Invoice, Recipes, EOD, Results)

Admin screens (Menu Management, Staff/Settings, Task Templates) are accessed from Dashboard links or the Settings screen — NOT in the bottom nav. Keep the nav clean.

---

## Coding Standards

- Use TypeScript strictly — no `any` types
- Use Supabase client library (`@supabase/supabase-js`) not raw fetch
- All forms use React state, not form libraries (keep it simple)
- Comments on every function explaining what it does in plain English
- Mobile-first responsive: design for 375px width, scale up
- Accessibility: proper labels on all form inputs, sufficient contrast ratios
- Error handling: toast notifications for success/failure, never silent failures
- All monetary values displayed with 2 decimal places and $ prefix (AUD)
- All timestamps displayed in Australian Eastern time (AEST/AEDT)
- Café day logic must be consistent everywhere — always use `cafe-day.ts` helpers, never raw Date() for "today"

---

## Future Integration Points (DO NOT BUILD YET)

- **Krema**: Will query Supabase tables for morning briefs, waste trends, task compliance %, calibration data
- **Grind**: Will read invoices + menu_items + waste_logs for cost analysis, margin tracking
- **Oolio POS API**: Could feed sales data into reporting
- **Deputy**: Could pull roster data to auto-populate who's on shift
- **Xero**: Submitted invoices will push to Xero for bookkeeping (API key placeholder exists in Settings)
- **n8n**: Automation pipelines connecting Beans → Slack (#krema-alerts) → Krema

These are Phase 2+. For now, build Beans as a standalone app that captures clean, structured data.
