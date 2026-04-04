'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { logActivity } from '@/lib/activity'
import type { MenuItem } from '@/lib/types'

type Category = MenuItem['category']

/** Badge colours for each menu item category */
const categoryBadge: Record<Category, string> = {
  coffee: 'bg-[#B8960C]/10 text-[#B8960C]',
  food: 'bg-green-50 text-green-700',
  beverage: 'bg-blue-50 text-blue-700',
  retail: 'bg-gray-100 text-gray-500',
}

/** A single extracted menu item awaiting review before import */
interface ExtractedItem {
  name: string
  category: Category
  sell_price: number
  selected: boolean
}

/** Converts a File to a base64 string for the Claude API */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Menu Management page — manager/owner only */
export default function MenuPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()
  const scanFileInputRef = useRef<HTMLInputElement>(null)

  const [items, setItems] = useState<MenuItem[]>([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // AI menu scan state
  const [scanPhoto, setScanPhoto] = useState<File | null>(null)
  const [scanPhotoPreview, setScanPhotoPreview] = useState<string | null>(null)
  // 'idle' | 'preview' | 'extracting' | 'review' | 'importing'
  const [scanMode, setScanMode] = useState<'idle' | 'preview' | 'extracting' | 'review' | 'importing'>('idle')
  const [extractedItems, setExtractedItems] = useState<ExtractedItem[]>([])

  // Auth guard — baristas cannot access this page
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
    if (!loading && profile && (profile.role === 'barista' || profile.role === 'kitchen')) router.push('/')
  }, [profile, loading, router])

  /** Fetch all menu items ordered by category then name */
  async function fetchItems() {
    const supabase = createClient()
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .order('category')
      .order('name')
    setItems(data ?? [])
    setLoadingItems(false)
  }

  useEffect(() => {
    if (profile) fetchItems()
  }, [profile])

  /** Handle photo selected for menu board scan */
  function handleScanPhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (scanPhotoPreview) URL.revokeObjectURL(scanPhotoPreview)
    setScanPhoto(file)
    setScanPhotoPreview(URL.createObjectURL(file))
    setScanMode('preview')
  }

  /** Reset the scan flow back to idle */
  function resetScan() {
    if (scanPhotoPreview) URL.revokeObjectURL(scanPhotoPreview)
    setScanPhoto(null)
    setScanPhotoPreview(null)
    setExtractedItems([])
    setScanMode('idle')
    if (scanFileInputRef.current) scanFileInputRef.current.value = ''
  }

  /** Send the photo to the AI menu extraction API and show review screen */
  async function handleExtractMenu() {
    if (!scanPhoto) return
    setScanMode('extracting')

    try {
      const base64 = await fileToBase64(scanPhoto)
      const response = await fetch('/api/ai-extract-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType: scanPhoto.type }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.error === 'Claude API key not configured') {
          showToast('AI extraction not configured. Add your Claude API key in Settings.', 'info')
        } else {
          showToast(data.error || 'Extraction failed', 'error')
        }
        resetScan()
        return
      }

      if (!Array.isArray(data.items) || data.items.length === 0) {
        showToast('No menu items found in that image', 'info')
        resetScan()
        return
      }

      // Map extracted items, all checked by default
      setExtractedItems(
        data.items.map((item: { name: string; category: Category; sell_price: number }) => ({
          name: item.name || '',
          category: item.category || 'coffee',
          sell_price: typeof item.sell_price === 'number' ? item.sell_price : 0,
          selected: true,
        }))
      )
      setScanMode('review')
    } catch {
      showToast('Extraction failed — try again', 'error')
      resetScan()
    }
  }

  /** Toggle selection of an extracted item */
  function toggleExtractedItem(index: number) {
    setExtractedItems(prev =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item))
    )
  }

  /** Update a field on an extracted item (inline editing in review) */
  function updateExtractedItem(index: number, field: keyof ExtractedItem, value: string | number | boolean) {
    setExtractedItems(prev =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  /** Bulk insert the selected extracted items into menu_items */
  async function handleImportItems() {
    const toImport = extractedItems.filter(i => i.selected)
    if (toImport.length === 0) {
      showToast('No items selected to import', 'info')
      return
    }

    setScanMode('importing')
    const supabase = createClient()

    const rows = toImport.map(item => ({
      name: item.name.trim(),
      category: item.category,
      sell_price: item.sell_price,
      cost_price: 0, // default — owner can update later
    }))

    const { error } = await supabase.from('menu_items').insert(rows)

    if (error) {
      showToast(error.message, 'error')
      setScanMode('review')
      return
    }

    showToast(`${toImport.length} item${toImport.length !== 1 ? 's' : ''} imported`, 'success')
    resetScan()
    fetchItems()
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Items to display — filter inactive unless toggle is on
  const visibleItems = showInactive ? items : items.filter(i => i.is_active)
  const selectedCount = extractedItems.filter(i => i.selected).length

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <button onClick={() => router.back()} className="text-[#B8960C] text-sm mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Menu Management</h1>
        <p className="text-sm text-gray-400 mt-1">Add & edit menu items</p>
      </div>

      <div className="px-5 space-y-4">
        {/* Section label + controls */}
        <div className="flex items-center justify-between">
          <p className="section-label">Menu Items ({visibleItems.length})</p>
          <div className="flex items-center gap-3">
            {/* Toggle to show/hide inactive items */}
            <button
              onClick={() => setShowInactive(v => !v)}
              className={`text-xs font-medium ${showInactive ? 'text-[#B8960C]' : 'text-gray-400'}`}
            >
              {showInactive ? 'Hide Inactive' : 'Show Inactive'}
            </button>

            {/* Scan menu board button */}
            <button
              onClick={() => scanFileInputRef.current?.click()}
              className="text-sm font-semibold text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full"
            >
              📷 Scan Menu
            </button>

            {/* Add item button */}
            <button
              onClick={() => setShowAddForm(v => !v)}
              className="text-sm font-semibold text-[#B8960C]"
            >
              {showAddForm ? 'Cancel' : '+ Add Item'}
            </button>
          </div>
        </div>

        {/* Hidden file input for menu board scan */}
        <input
          ref={scanFileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleScanPhotoSelect}
        />

        {/* ── AI Scan flow overlay / section ── */}

        {/* PREVIEW: photo captured, offer extract */}
        {scanMode === 'preview' && (
          <div className="bg-white rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[#1A1A1A]">Menu Board Photo</h3>
              <button onClick={resetScan} className="text-gray-400 text-sm">Cancel</button>
            </div>
            {scanPhotoPreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={scanPhotoPreview}
                alt="Menu board"
                className="w-full h-48 object-cover rounded-xl"
              />
            )}
            <button
              onClick={handleExtractMenu}
              className="w-full py-4 rounded-full bg-[#B8960C] text-white font-bold text-base flex items-center justify-center gap-2"
            >
              <span>✨</span>
              <span>Extract with AI</span>
            </button>
          </div>
        )}

        {/* EXTRACTING: spinner */}
        {scanMode === 'extracting' && (
          <div className="bg-white rounded-2xl p-8 flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
            <p className="font-semibold text-[#1A1A1A]">Reading menu board with AI…</p>
            <p className="text-sm text-gray-400 text-center">Claude is identifying items and prices.</p>
          </div>
        )}

        {/* IMPORTING: spinner */}
        {scanMode === 'importing' && (
          <div className="bg-white rounded-2xl p-8 flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
            <p className="font-semibold text-[#1A1A1A]">Importing items…</p>
          </div>
        )}

        {/* REVIEW: extracted items list with checkboxes and inline editing */}
        {scanMode === 'review' && (
          <div className="bg-white rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[#1A1A1A]">
                Review Extracted Items
              </h3>
              <button onClick={resetScan} className="text-gray-400 text-sm">Cancel</button>
            </div>

            <p className="text-xs text-gray-400">
              Uncheck items you don&apos;t want to import. Tap a name or price to edit.
            </p>

            <div className="space-y-2">
              {extractedItems.map((item, index) => (
                <div
                  key={index}
                  className={`rounded-xl border p-3 space-y-2 transition-opacity ${
                    item.selected ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleExtractedItem(index)}
                      className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                        item.selected
                          ? 'bg-[#B8960C] border-[#B8960C] text-white'
                          : 'border-gray-300 bg-white'
                      }`}
                    >
                      {item.selected && (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>

                    {/* Name (inline editable) */}
                    <input
                      type="text"
                      value={item.name}
                      onChange={e => updateExtractedItem(index, 'name', e.target.value)}
                      disabled={!item.selected}
                      className="flex-1 text-sm font-medium text-[#1A1A1A] bg-transparent border-b border-transparent focus:border-[#B8960C] focus:outline-none disabled:text-gray-400"
                    />

                    {/* Category badge (select) */}
                    <select
                      value={item.category}
                      onChange={e => updateExtractedItem(index, 'category', e.target.value as Category)}
                      disabled={!item.selected}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium border-0 focus:outline-none focus:ring-1 focus:ring-[#B8960C] ${categoryBadge[item.category]} disabled:opacity-50`}
                    >
                      <option value="coffee">coffee</option>
                      <option value="food">food</option>
                      <option value="beverage">beverage</option>
                      <option value="retail">retail</option>
                    </select>
                  </div>

                  {/* Price (inline editable) */}
                  <div className="flex items-center gap-2 pl-9">
                    <span className="text-xs text-gray-400">Sell price:</span>
                    <div className="flex items-center gap-0.5">
                      <span className="text-xs text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.50"
                        min="0"
                        value={item.sell_price}
                        onChange={e => updateExtractedItem(index, 'sell_price', parseFloat(e.target.value) || 0)}
                        disabled={!item.selected}
                        className="w-16 text-sm font-semibold text-[#1A1A1A] bg-transparent border-b border-transparent focus:border-[#B8960C] focus:outline-none disabled:text-gray-400"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Import button */}
            <button
              onClick={handleImportItems}
              disabled={selectedCount === 0}
              className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
            >
              Import {selectedCount} item{selectedCount !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {/* Add item form */}
        {showAddForm && (
          <AddItemForm
            profileId={profile.id}
            onSuccess={() => {
              setShowAddForm(false)
              fetchItems()
              showToast('Item added', 'success')
            }}
            onError={(msg) => showToast(msg, 'error')}
          />
        )}

        {/* Items list */}
        {loadingItems ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center">
            <p className="text-gray-400 text-sm">No menu items yet. Add one above.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleItems.map(item => (
              <MenuItemCard
                key={item.id}
                item={item}
                isEditing={editingId === item.id}
                onEdit={() => setEditingId(item.id)}
                onCancelEdit={() => setEditingId(null)}
                onUpdated={() => {
                  setEditingId(null)
                  fetchItems()
                  showToast('Item updated', 'success')
                }}
                onError={(msg) => showToast(msg, 'error')}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Form to add a new menu item */
function AddItemForm({
  profileId,
  onSuccess,
  onError,
}: {
  profileId: string
  onSuccess: () => void
  onError: (msg: string) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('coffee')
  const [sellPrice, setSellPrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    if (!name.trim()) { onError('Name is required'); return }
    const sell = parseFloat(sellPrice)
    const cost = parseFloat(costPrice)
    if (isNaN(sell) || sell < 0) { onError('Enter a valid sell price'); return }
    if (isNaN(cost) || cost < 0) { onError('Enter a valid cost price'); return }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from('menu_items').insert({
      name: name.trim(),
      category,
      sell_price: sell,
      cost_price: cost,
    })
    setLoading(false)

    if (error) { onError(error.message); return }
    await logActivity(profileId, 'menu_item_added', `Added menu item: ${name.trim()}`)
    onSuccess()
  }

  return (
    <div className="bg-white rounded-2xl p-4 space-y-3">
      <h3 className="font-semibold text-[#1A1A1A]">New Menu Item</h3>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Flat White"
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Category</label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value as Category)}
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        >
          <option value="coffee">Coffee</option>
          <option value="food">Food</option>
          <option value="beverage">Beverage</option>
          <option value="retail">Retail</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Sell Price</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={sellPrice}
            onChange={e => setSellPrice(e.target.value)}
            placeholder="0.00"
            className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Cost Price</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={costPrice}
            onChange={e => setCostPrice(e.target.value)}
            placeholder="0.00"
            className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
          />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
      >
        {loading ? 'Adding…' : 'Add Item'}
      </button>
    </div>
  )
}

/** Single menu item card with inline edit capability */
function MenuItemCard({
  item,
  isEditing,
  onEdit,
  onCancelEdit,
  onUpdated,
  onError,
}: {
  item: MenuItem
  isEditing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onUpdated: () => void
  onError: (msg: string) => void
}) {
  const [name, setName] = useState(item.name)
  const [category, setCategory] = useState<Category>(item.category)
  const [sellPrice, setSellPrice] = useState(item.sell_price.toString())
  const [costPrice, setCostPrice] = useState(item.cost_price.toString())
  const [isActive, setIsActive] = useState(item.is_active)
  const [loading, setLoading] = useState(false)

  async function handleUpdate() {
    if (!name.trim()) { onError('Name is required'); return }
    const sell = parseFloat(sellPrice)
    const cost = parseFloat(costPrice)
    if (isNaN(sell) || sell < 0) { onError('Enter a valid sell price'); return }
    if (isNaN(cost) || cost < 0) { onError('Enter a valid cost price'); return }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('menu_items')
      .update({ name: name.trim(), category, sell_price: sell, cost_price: cost, is_active: isActive })
      .eq('id', item.id)
    setLoading(false)

    if (error) { onError(error.message); return }
    onUpdated()
  }

  if (!isEditing) {
    return (
      <div className={`bg-white rounded-2xl p-4 ${!item.is_active ? 'opacity-50' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-[#1A1A1A]">{item.name}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryBadge[item.category]}`}>
                {item.category}
              </span>
              {!item.is_active && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-500 font-medium">
                  Inactive
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-sm text-gray-700">Sell: <span className="font-medium">{formatCurrency(item.sell_price)}</span></span>
              <span className="text-gray-300">·</span>
              <span className="text-sm text-gray-500">Cost: {formatCurrency(item.cost_price)}</span>
            </div>
          </div>
          <button onClick={onEdit} className="text-[#B8960C] text-sm font-medium ml-3 shrink-0">
            Edit
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-4 space-y-3 border-2 border-[#B8960C]/20">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[#1A1A1A]">Edit {item.name}</h3>
        <button onClick={onCancelEdit} className="text-gray-400 text-sm">Cancel</button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Category</label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value as Category)}
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        >
          <option value="coffee">Coffee</option>
          <option value="food">Food</option>
          <option value="beverage">Beverage</option>
          <option value="retail">Retail</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Sell Price</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={sellPrice}
            onChange={e => setSellPrice(e.target.value)}
            className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Cost Price</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={costPrice}
            onChange={e => setCostPrice(e.target.value)}
            className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
          />
        </div>
      </div>

      {/* Active toggle */}
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="font-medium text-[#1A1A1A] text-sm">Active</p>
          <p className="text-xs text-gray-400">Inactive items won&apos;t appear in Waste dropdown</p>
        </div>
        <button
          onClick={() => setIsActive(v => !v)}
          className={`w-12 h-6 rounded-full transition-colors relative ${isActive ? 'bg-[#16A34A]' : 'bg-gray-200'}`}
        >
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${isActive ? 'left-7' : 'left-1'}`} />
        </button>
      </div>

      <button
        onClick={handleUpdate}
        disabled={loading}
        className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
      >
        {loading ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  )
}
