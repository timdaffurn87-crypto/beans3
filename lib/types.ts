export type Role = 'barista' | 'manager' | 'owner'

export interface Profile {
  id: string
  full_name: string
  role: Role
  pin: string
  is_active: boolean
  created_at: string
}

export interface Calibration {
  id: string
  staff_id: string
  grinder_setting: number
  dose_grams: number
  yield_grams: number
  time_seconds: number
  ratio: number
  notes: string | null
  cafe_day: string
  created_at: string
}

export interface MenuItem {
  id: string
  name: string
  category: 'coffee' | 'food' | 'beverage' | 'retail'
  sell_price: number
  cost_price: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface WasteLog {
  id: string
  staff_id: string
  menu_item_id: string
  item_name: string
  quantity: number
  unit_cost: number
  total_cost: number
  reason: string
  notes: string | null
  cafe_day: string
  created_at: string
}

export interface TaskTemplate {
  id: string
  title: string
  description: string | null
  station: string
  sort_order: number
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface DailyTask {
  id: string
  template_id: string
  cafe_day: string
  title: string
  description: string | null
  station: string
  completed_by: string | null
  completed_at: string | null
  created_at: string
}

export interface Invoice {
  id: string
  scanned_by: string
  supplier_name: string
  supplier_email: string | null
  invoice_date: string | null
  due_date: string | null
  reference_number: string | null  // used as InvoiceNumber in Xero
  total_amount: number
  line_items: LineItem[]
  photo_url: string
  ai_confidence: 'high' | 'medium' | 'low' | null
  status: 'pending' | 'submitted'
  cafe_day: string
  created_at: string
  xero_invoice_id: string | null     // Xero Invoice ID once pushed; null = not yet sent
  xero_sync_status: 'pending' | 'synced' | 'failed' | 'review'  // 'review' = gst_flagged, held back from batch until resolved
  xero_synced_at: string | null      // timestamp of last successful Xero sync
  tax_type: 'INCLUSIVE' | 'EXCLUSIVE' | 'NOTAX' | null  // Xero LineAmountTypes value
  gst_flagged: boolean               // true when AI cannot determine GST treatment
}

export type TaxType = 'NONE' | 'INPUT2' | 'BASEXCLUDED'

export interface LineItem {
  description: string
  quantity: number
  unit_amount: number          // GST-inclusive price per unit — maps to Xero UnitAmount
  account_code: string         // default "300" (COGS) — maps to Xero AccountCode
  inventory_item_code: string  // optional — maps to Xero InventoryItemCode
  tax_type: TaxType            // "NONE" (GST-free), "INPUT2" (GST on Expenses), "BASEXCLUDED" (outside BAS)
}

export interface InventoryItem {
  id: string
  name: string
  supplier_name: string | null
  unit_of_measure: string
  unit_price: number
  default_tax_type: TaxType
  xero_account_code: string
  xero_inventory_item_code: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Recipe {
  id: string
  name: string
  category: 'coffee' | 'food' | 'beverage'
  ingredients: Ingredient[]
  method: string[]
  notes: string | null
  photo_url: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface Ingredient {
  name: string
  quantity: string
  unit: string
  inventory_item_id?: string   // optional link to inventory_items for price sync
}

export interface EODReport {
  id: string
  submitted_by: string
  cafe_day: string
  tasks_completed: number
  tasks_total: number
  waste_total_value: number
  waste_top_items: { item_name: string; total_cost: number; quantity: number }[]
  calibration_count: number
  calibration_compliance_pct: number
  calibration_gaps: { gap_start: string; gap_end: string; duration_minutes: number }[] | null
  invoices_count: number
  invoices_total_value: number
  invoice_ids: string[]
  notes: string | null
  created_at: string
}

export interface Setting {
  id: string
  key: string
  value: string
  updated_at: string
}

export interface ActivityLog {
  id: string
  staff_id: string
  action_type: string
  description: string
  amount: number | null
  cafe_day: string
  created_at: string
}
