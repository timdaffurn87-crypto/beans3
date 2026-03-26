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

  // Menu items for the dropdown
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

  /** Load all active menu items for the dropdown */
  async function fetchMenuItems() {
    const supabase = createClient()
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('is_active', true)
      .order('category')
      .order('name')
    setMenuItems(data ?? [])
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

  /** When a menu item is selected from the dropdown, update related state */
  function handleItemSelect(id: string) {
    const item = menuItems.find(m => m.id === id)
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

    const { error } = await supabase.from('waste_logs').insert({
      staff_id: profile.id,
      menu_item_id: selectedItemId,
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
    // Log activity
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
    // Refresh today's log
    fetchWasteLog()
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Live estimated loss calculation
  const qty = parseInt(quantity, 10) || 0
  const estimatedLoss = qty * selectedCostPrice

  // Group menu items by category for the grouped <select>
  const categories = Array.from(new Set(menuItems.map(m => m.category)))

  // Today's running waste total
  const wasteTotal = wasteLog.reduce((sum, w) => sum + w.total_cost, 0)

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <button onClick={() => router.back()} className="text-[#B8960C] text-sm mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Waste Logger</h1>
      </div>

      <div className="px-5 space-y-6">
        {/* Waste form */}
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
          <h2 className="font-semibold text-[#1A1A1A]">Log Waste</h2>

          {/* Menu item — grouped select */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Menu Item</label>
            <select
              value={selectedItemId}
              onChange={e => handleItemSelect(e.target.value)}
              className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
            >
              <option value="">Select an item…</option>
              {categories.map(cat => (
                <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                  {menuItems
                    .filter(m => m.category === cat)
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} — {formatCurrency(m.sell_price)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Quantity</label>
            <input
              type="number"
              step="1"
              min="1"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="1"
              className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
            />
          </div>

          {/* Reason */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Reason</label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
            >
              {WASTE_REASONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any extra details…"
              rows={2}
              className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C] resize-none"
            />
          </div>

          {/* Estimated loss — prominent live display */}
          <div className="px-4 py-4 bg-[#FAF8F3] rounded-xl">
            <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-1">Estimated Loss</p>
            {selectedItemId ? (
              selectedCostPrice > 0 ? (
                <p className="text-3xl font-bold text-[#DC2626]">{formatCurrency(estimatedLoss)}</p>
              ) : (
                <p className="text-base text-gray-400">Cost price not set</p>
              )
            ) : (
              <p className="text-base text-gray-400">Select an item to calculate</p>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
          >
            {submitting ? 'Logging…' : 'Log Waste'}
          </button>
        </div>

        {/* Today's waste log */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">Today's Waste Log</p>
          </div>

          {/* Running total */}
          {wasteLog.length > 0 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">Today's Total</span>
              <span className="text-xl font-bold text-[#DC2626]">{formatCurrency(wasteTotal)}</span>
            </div>
          )}

          {loadingLog ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : wasteLog.length === 0 ? (
            <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
              <p className="text-gray-400 text-sm">No waste logged today</p>
            </div>
          ) : (
            <div className="space-y-2">
              {wasteLog.map(entry => (
                <div key={entry.id} className="bg-white rounded-2xl p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-semibold text-[#1A1A1A] text-sm">{entry.item_name}</p>
                      <p className="text-sm text-gray-600 mt-0.5">
                        {entry.quantity} × {entry.reason}
                      </p>
                      {entry.notes && (
                        <p className="text-xs text-gray-400 mt-0.5 italic">{entry.notes}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {entry.profiles?.full_name ?? 'Unknown'} · {formatTime(entry.created_at)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-[#DC2626] text-sm">{formatCurrency(entry.total_cost)}</p>
                    </div>
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
