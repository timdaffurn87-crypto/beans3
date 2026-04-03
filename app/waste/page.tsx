'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { getCurrentCafeDay } from '@/lib/cafe-day'
import { formatCurrency, formatTime } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { logActivity } from '@/lib/activity'
import type { MenuItem, WasteLog, Profile } from '@/lib/types'

/** Waste log row joined with the logger's profile */
interface WasteLogWithProfile extends WasteLog {
  profiles: Pick<Profile, 'full_name'> | null
}

/** Combined item for the waste dropdown — can be a menu item or an inventory item */
interface WasteDropdownItem {
  id: string
  name: string
  cost_price: number
  source: 'menu' | 'inventory'   // which table this came from
  category?: string
}

/** Reasons a waste event can have */
const WASTE_REASONS = [
  'Expired',
  'Spilled',
  'Overproduction',
  'Damaged',
  'Quality Issue',
  'Dropped',
  'Wrong Order',
  'Customer Return',
]

/** Waste Logger page — all roles */
export default function WastePage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()

  // Combined dropdown items (menu items + inventory items)
  const [dropdownItems, setDropdownItems] = useState<WasteDropdownItem[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])

  // Form state
  const [selectedItemId, setSelectedItemId] = useState('')
  const [selectedItemName, setSelectedItemName] = useState('')
  const [selectedCostPrice, setSelectedCostPrice] = useState(0)
  const [quantity, setQuantity] = useState('1')
  const [reason, setReason] = useState(WASTE_REASONS[0])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Today's waste log
  const [wasteLog, setWasteLog] = useState<WasteLogWithProfile[]>([])
  const [loadingLog, setLoadingLog] = useState(true)

  // Auth guard — redirect to login if no profile
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
  }, [profile, loading, router])

  /** Load all active menu items + inventory items for the waste dropdown */
  async function fetchMenuItems() {
    const supabase = createClient()

    // Fetch menu items (finished products like "Flat White")
    const { data: menuData } = await supabase
      .from('menu_items')
      .select('*')
      .eq('is_active', true)
      .order('category')
      .order('name')
    setMenuItems(menuData ?? [])

    // Fetch inventory items (raw ingredients from invoices like "Arabica Beans 1kg")
    const { data: inventoryData } = await supabase
      .from('inventory_items')
      .select('id, name, unit_price, supplier_name')
      .eq('is_active', true)
      .order('name')

    type InvRow = { id: string; name: string; unit_price: number; supplier_name: string | null }

    // Combine into a single dropdown list — menu items first, then inventory items
    const combined: WasteDropdownItem[] = [
      ...(menuData ?? []).map((m: MenuItem) => ({
        id: m.id,
        name: m.name,
        cost_price: m.cost_price,
        source: 'menu' as const,
        category: m.category,
      })),
      ...((inventoryData as InvRow[] | null) ?? [])
        // Exclude inventory items whose name already exists in menu items (avoid duplicates)
        .filter(inv => !(menuData ?? []).some((m: MenuItem) => m.name.toLowerCase() === inv.name.toLowerCase()))
        .map(inv => ({
          id: inv.id,
          name: inv.name,
          cost_price: inv.unit_price,
          source: 'inventory' as const,
          category: inv.supplier_name ? `Inventory · ${inv.supplier_name}` : 'Inventory',
        })),
    ]
    setDropdownItems(combined)
  }

  /** Fetch today's waste log entries with staff names */
  async function fetchWasteLog() {
    const supabase = createClient()
    const cafeDay = getCurrentCafeDay()

    const { data } = await supabase
      .from('waste_logs')
      .select('*, profiles(full_name)')
      .eq('cafe_day', cafeDay)
      .order('created_at', { ascending: false })

    setWasteLog((data as WasteLogWithProfile[]) ?? [])
    setLoadingLog(false)
  }

  useEffect(() => {
    if (profile) {
      fetchMenuItems()
      fetchWasteLog()
    }
  }, [profile])

  /** When an item is selected from the dropdown, update related state */
  function handleItemSelect(id: string) {
    const item = dropdownItems.find(d => d.id === id)
    if (!item) {
      setSelectedItemId('')
      setSelectedItemName('')
      setSelectedCostPrice(0)
      return
    }
    setSelectedItemId(item.id)
    setSelectedItemName(item.name)
    setSelectedCostPrice(item.cost_price)
  }

  /** Submit the waste log entry */
  async function handleSubmit() {
    if (!profile) return
    if (!selectedItemId) { showToast('Select a menu item', 'error'); return }
    const qty = parseInt(quantity, 10)
    if (!qty || qty < 1) { showToast('Quantity must be at least 1', 'error'); return }

    setSubmitting(true)
    const supabase = createClient()
    const cafeDay = getCurrentCafeDay()
    const totalCost = qty * selectedCostPrice

    // Determine whether the selected item is from menu_items or inventory_items
    const selectedDropdownItem = dropdownItems.find(d => d.id === selectedItemId)
    const isInventoryItem = selectedDropdownItem?.source === 'inventory'

    const { error } = await supabase.from('waste_logs').insert({
      staff_id: profile.id,
      menu_item_id: isInventoryItem ? null : selectedItemId,
      inventory_item_id: isInventoryItem ? selectedItemId : null,
      item_name: selectedItemName,
      quantity: qty,
      unit_cost: selectedCostPrice,
      total_cost: totalCost,
      reason,
      notes: notes.trim() || null,
      cafe_day: cafeDay,
    })

    setSubmitting(false)

    if (error) {
      showToast(error.message, 'error')
      return
    }

    showToast('Waste logged', 'success')
    await logActivity(
      profile.id,
      'waste_logged',
      `Wasted ${qty}x ${selectedItemName} (${reason})`,
      totalCost
    )
    // Reset form to defaults
    setSelectedItemId('')
    setSelectedItemName('')
    setSelectedCostPrice(0)
    setQuantity('1')
    setReason(WASTE_REASONS[0])
    setNotes('')
    fetchWasteLog()
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#296861', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  // Computed values
  const qty           = parseInt(quantity, 10) || 0
  const estimatedLoss = qty * selectedCostPrice
  const categories    = Array.from(new Set(dropdownItems.map(d => d.category ?? 'other')))
  const wasteTotal    = wasteLog.reduce((sum, w) => sum + w.total_cost, 0)

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>

      {/* ── Header ── */}
      <div className="px-5 pt-12 pb-4">
        <p className="section-label mb-2" style={{ color: '#296861' }}>Inventory Management</p>
        <h1 className="text-4xl font-bold leading-none" style={{ color: '#2D2D2D' }}>
          Waste
          <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic', display: 'block' }}>
            Logger
          </span>
        </h1>
        <div className="w-10 h-0.5 rounded-full mt-3" style={{ backgroundColor: '#B8960C' }} />
      </div>

      <div className="px-5 space-y-5">

        {/* ── Running total banner — shown once entries exist ── */}
        {wasteLog.length > 0 && (
          <div className="rounded-2xl p-4 card-interactive" style={{ background: 'linear-gradient(135deg, #296861 0%, #1a4a45 100%)' }}>
            <p className="section-label text-white/60 mb-1">Today&apos;s Waste Total</p>
            <p className="text-4xl font-bold text-white" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif' }}>
              {formatCurrency(wasteTotal)}
            </p>
            <p className="section-label text-white/40 mt-1">{wasteLog.length} {wasteLog.length === 1 ? 'entry' : 'entries'} logged</p>
          </div>
        )}

        {/* ── Log Waste form card ── */}
        <div className="bg-white rounded-2xl p-5 space-y-4">

          {/* Card header */}
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '20px' }}>delete</span>
            <p className="font-semibold" style={{ color: '#2D2D2D' }}>Capture Loss</p>
          </div>

          {/* Menu item — grouped select */}
          <div className="flex flex-col gap-1.5">
            <label className="section-label">Menu Item</label>
            <select
              value={selectedItemId}
              onChange={e => handleItemSelect(e.target.value)}
              className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
            >
              <option value="">Select an item…</option>
              {categories.map(cat => (
                <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                  {dropdownItems
                    .filter(d => (d.category ?? 'other') === cat)
                    .map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name} — {formatCurrency(d.cost_price)}{d.source === 'inventory' ? ' (inv)' : ''}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Quantity + Reason in a 2-col grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="section-label">Quantity</label>
              <input
                type="number"
                step="1"
                min="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="1"
                className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="section-label">Reason</label>
              <select
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
              >
                {WASTE_REASONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="section-label">Notes <span className="normal-case font-normal text-gray-400">(optional)</span></label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any extra details…"
              rows={2}
              className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861] resize-none"
            />
          </div>

          {/* Estimated loss — amber card, updates live */}
          <div className="rounded-xl p-4" style={{ backgroundColor: '#FFF8E7' }}>
            <p className="section-label mb-1" style={{ color: '#C47F17' }}>Estimated Loss</p>
            {selectedItemId ? (
              selectedCostPrice > 0 ? (
                <p className="text-3xl font-bold" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', color: '#C47F17' }}>
                  {formatCurrency(estimatedLoss)}
                </p>
              ) : (
                <p className="text-sm text-[#C47F17]/70">Cost price not set for this item</p>
              )
            ) : (
              <p className="text-sm text-[#C47F17]/70">Select an item to calculate</p>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 rounded-full font-semibold text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #296861 0%, #73b0a8 100%)' }}
          >
            {submitting ? 'Logging…' : 'Log Waste Entry'}
          </button>
        </div>

        {/* ── Today's Waste Log ── */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-2xl font-bold" style={{ color: '#2D2D2D' }}>
              Today&apos;s{' '}
              <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic' }}>Log</span>
            </h2>
            {wasteLog.length > 0 && (
              <span className="text-xs font-semibold" style={{ color: '#296861' }}>{wasteLog.length} entries</span>
            )}
          </div>

          {loadingLog ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#296861', borderTopColor: 'transparent' }} />
            </div>
          ) : wasteLog.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center">
              <span className="material-symbols-outlined text-gray-200 block mb-2" style={{ fontSize: '40px' }}>delete_outline</span>
              <p className="text-sm text-gray-400">No waste logged today</p>
            </div>
          ) : (
            <div className="space-y-2">
              {wasteLog.map((entry, index) => (
                <div
                  key={entry.id}
                  className="bg-white rounded-2xl p-4 card-interactive"
                  style={{ borderLeft: '3px solid #296861' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {/* Entry number */}
                      <span className="text-2xl font-bold shrink-0" style={{ color: '#E8E2D2', fontFamily: 'var(--font-newsreader), Georgia, serif' }}>
                        {String(wasteLog.length - index).padStart(2, '0')}
                      </span>
                      <div>
                        <p className="font-semibold text-sm" style={{ color: '#2D2D2D' }}>{entry.item_name}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-gray-500">{entry.quantity} × {entry.reason}</span>
                          {entry.notes && (
                            <span className="text-xs text-gray-400 italic">{entry.notes}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {entry.profiles?.full_name ?? 'Unknown'} · {formatTime(entry.created_at)}
                        </p>
                      </div>
                    </div>
                    <p className="font-bold text-sm shrink-0" style={{ color: '#DC2626' }}>
                      {formatCurrency(entry.total_cost)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
