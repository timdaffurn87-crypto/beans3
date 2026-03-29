'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { getCurrentCafeDay } from '@/lib/cafe-day'
import { formatCurrency, formatTime, formatDisplayDate } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { logActivity } from '@/lib/activity'
import type { Invoice, LineItem } from '@/lib/types'

/** Converts a File object to a base64 string for the AI API */
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

/** Returns a date string 30 days after the given YYYY-MM-DD string */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** A blank line item with Xero defaults */
function blankLineItem(): LineItem {
  return { description: '', quantity: 1, unit_amount: 0, account_code: '300', inventory_item_code: '' }
}

/** Invoice Scanning page — all roles */
export default function InvoicePage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  // File state
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [isPdf, setIsPdf] = useState(false)

  // UI mode: capture → choose → extracting → form
  const [uiMode, setUiMode] = useState<'capture' | 'choose' | 'extracting' | 'form'>('capture')

  // AI confidence after extraction
  const [aiConfidence, setAiConfidence] = useState<'high' | 'medium' | 'low' | null>(null)

  // GST detection state — set by AI extraction, shown as warning banner when flagged
  const [gstFlagged, setGstFlagged] = useState(false)
  const [taxType, setTaxType] = useState<'INCLUSIVE' | 'EXCLUSIVE' | 'NOTAX' | null>(null)

  // Form fields — aligned to Xero Bill Import columns
  const [supplierName, setSupplierName] = useState('')       // ContactName
  const [supplierEmail, setSupplierEmail] = useState('')     // EmailAddress
  const [invoiceNumber, setInvoiceNumber] = useState('')     // InvoiceNumber
  const [invoiceDate, setInvoiceDate] = useState('')         // InvoiceDate (YYYY-MM-DD)
  const [dueDate, setDueDate] = useState('')                 // DueDate (YYYY-MM-DD)
  const [lineItems, setLineItems] = useState<LineItem[]>([blankLineItem()])

  // Auto-set due date to 30 days after invoice date when invoice date changes
  useEffect(() => {
    if (invoiceDate) {
      setDueDate(prev => prev || addDays(invoiceDate, 30))
    }
  }, [invoiceDate])

  const [submitting, setSubmitting] = useState(false)
  const [todayInvoices, setTodayInvoices] = useState<Invoice[]>([])
  const [loadingInvoices, setLoadingInvoices] = useState(true)

  useEffect(() => {
    if (!loading && !profile) router.push('/login')
  }, [profile, loading, router])

  /** Fetch all invoices for today's café day */
  async function fetchTodayInvoices() {
    const supabase = createClient()
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('cafe_day', getCurrentCafeDay())
      .order('created_at', { ascending: false })
    setTodayInvoices((data as Invoice[]) ?? [])
    setLoadingInvoices(false)
  }

  useEffect(() => {
    if (profile) fetchTodayInvoices()
  }, [profile])

  /** Handle file selection from any input */
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    const pdf = file.type === 'application/pdf'
    setIsPdf(pdf)
    setPhoto(file)
    setPhotoPreview(pdf ? null : URL.createObjectURL(file))
    setUiMode('choose')
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (libraryInputRef.current) libraryInputRef.current.value = ''
    if (pdfInputRef.current) pdfInputRef.current.value = ''
  }

  function handleRemovePhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhoto(null)
    setPhotoPreview(null)
    setIsPdf(false)
  }

  /**
   * Sends the captured file to the AI extraction API.
   * Pre-fills the form on success; falls through to blank manual entry on failure.
   */
  async function handleExtractWithAI() {
    if (!photo) return
    setUiMode('extracting')

    try {
      const base64 = await fileToBase64(photo)
      const response = await fetch('/api/ai-extract-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType: photo.type }),
      })
      const data = await response.json()

      if (!response.ok) {
        showToast(data.error || 'AI extraction failed — fill in manually', 'error')
        setUiMode('form')
        return
      }

      // Populate form with extracted values
      setSupplierName(data.supplier_name || '')
      setSupplierEmail(data.supplier_email || '')
      setInvoiceNumber(data.invoice_number || '')
      setInvoiceDate(data.invoice_date || '')
      // due_date: use AI value if present, else auto-set via the useEffect above
      if (data.due_date) setDueDate(data.due_date)
      else if (data.invoice_date) setDueDate(addDays(data.invoice_date, 30))

      // Map AI line items to our structure
      if (Array.isArray(data.line_items) && data.line_items.length > 0) {
        setLineItems(data.line_items.map((item: Partial<LineItem>) => ({
          description: item.description || '',
          quantity: item.quantity ?? 1,
          unit_amount: item.unit_amount ?? 0,
          account_code: item.account_code || '300',
          inventory_item_code: item.inventory_item_code || '',
        })))
      } else {
        setLineItems([blankLineItem()])
      }

      setAiConfidence(data.confidence || null)
      setGstFlagged(data.gst_flagged ?? false)
      setTaxType(data.tax_type ?? null)
      setUiMode('form')
      showToast('Invoice extracted — please verify', 'success')
    } catch {
      showToast('AI extraction failed — fill in manually', 'error')
      setUiMode('form')
    }
  }

  /** Add a blank line item row */
  function addLineItem() {
    setLineItems(prev => [...prev, blankLineItem()])
  }

  /** Update a single field on a line item by index */
  function updateLineItem(index: number, field: keyof LineItem, value: string | number) {
    setLineItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  function removeLineItem(index: number) {
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  /** Reset back to initial capture state */
  function resetForm() {
    handleRemovePhoto()
    setUiMode('capture')
    setSupplierName('')
    setSupplierEmail('')
    setInvoiceNumber('')
    setInvoiceDate('')
    setDueDate('')
    setLineItems([blankLineItem()])
    setAiConfidence(null)
    setGstFlagged(false)
    setTaxType(null)
    setIsPdf(false)
  }

  /** Upload photo to Supabase Storage and return the public URL */
  async function uploadPhoto(file: File, cafeDay: string): Promise<string> {
    const supabase = createClient()
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const { error } = await supabase.storage
      .from('invoice-photos')
      .upload(`${cafeDay}/${filename}`, file)
    if (error) throw new Error(`Photo upload failed: ${error.message}`)
    const { data } = supabase.storage.from('invoice-photos').getPublicUrl(`${cafeDay}/${filename}`)
    return data.publicUrl
  }

  /** Save the invoice to the database */
  async function handleSubmit() {
    if (!profile) return

    if (!supplierName.trim()) { showToast('Supplier name is required', 'error'); return }
    if (!invoiceNumber.trim()) { showToast('Invoice number is required', 'error'); return }
    if (!invoiceDate) { showToast('Invoice date is required', 'error'); return }
    if (!dueDate) { showToast('Due date is required', 'error'); return }
    if (lineItems.length === 0) { showToast('Add at least one line item', 'error'); return }

    setSubmitting(true)
    const supabase = createClient()
    const cafeDay = getCurrentCafeDay()

    try {
      let photoUrl = ''
      if (photo) photoUrl = await uploadPhoto(photo, cafeDay)

      // Calculate total from line items (quantity × unit_amount)
      const totalAmount = lineItems.reduce((sum, item) => sum + (item.quantity * item.unit_amount), 0)

      // gst_flagged invoices get xero_sync_status='review' — they are excluded
      // from the 3 PM batch until a manager resolves the GST treatment manually.
      const xeroSyncStatus = gstFlagged ? 'review' : 'pending'

      const { error } = await supabase.from('invoices').insert({
        scanned_by: profile.id,
        supplier_name: supplierName.trim(),
        supplier_email: supplierEmail.trim() || null,
        invoice_date: invoiceDate,
        due_date: dueDate,
        reference_number: invoiceNumber.trim(),
        total_amount: totalAmount,
        line_items: lineItems,
        photo_url: photoUrl,
        ai_confidence: aiConfidence,
        status: 'pending',
        cafe_day: cafeDay,
        gst_flagged: gstFlagged,
        tax_type: taxType,
        xero_sync_status: xeroSyncStatus,
      })

      if (error) { showToast(error.message, 'error'); return }

      showToast('Invoice saved', 'success')
      await logActivity(profile.id, 'invoice_scanned', `Invoice from ${supplierName.trim()}`, totalAmount)
      resetForm()
      fetchTodayInvoices()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const todayTotal = todayInvoices.reduce((sum, inv) => sum + inv.total_amount, 0)

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <button onClick={() => router.back()} className="text-[#B8960C] text-sm mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Scan Invoice</h1>
        <p className="text-sm text-gray-400 mt-1">Xero-ready bill capture</p>
      </div>

      <div className="px-5 space-y-6">

        {/* ── CAPTURE MODE ── */}
        {uiMode === 'capture' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm space-y-3">
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
            <input ref={libraryInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileSelect} />

            <button onClick={() => cameraInputRef.current?.click()}
              className="w-full flex items-center gap-4 p-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors">
              <span className="text-2xl">📷</span>
              <div className="text-left">
                <p className="font-semibold text-sm">Take Photo</p>
                <p className="text-xs text-gray-400">Open camera to photograph invoice</p>
              </div>
            </button>

            <button onClick={() => libraryInputRef.current?.click()}
              className="w-full flex items-center gap-4 p-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors">
              <span className="text-2xl">🖼️</span>
              <div className="text-left">
                <p className="font-semibold text-sm">Upload from Library</p>
                <p className="text-xs text-gray-400">Choose an existing photo</p>
              </div>
            </button>

            <button onClick={() => pdfInputRef.current?.click()}
              className="w-full flex items-center gap-4 p-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors">
              <span className="text-2xl">📄</span>
              <div className="text-left">
                <p className="font-semibold text-sm">Upload PDF</p>
                <p className="text-xs text-gray-400">Select a PDF invoice file</p>
              </div>
            </button>

            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400 font-medium">OR</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <button onClick={() => setUiMode('form')}
              className="w-full text-center text-sm text-[#B8960C] font-medium py-2">
              Enter manually (no file)
            </button>
          </div>
        )}

        {/* ── CHOOSE MODE ── */}
        {uiMode === 'choose' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
            {photoPreview && !isPdf && (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview} alt="Invoice photo" className="w-full h-44 object-cover rounded-xl" />
                <button onClick={() => { handleRemovePhoto(); setUiMode('capture') }}
                  className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                  × Retake
                </button>
              </div>
            )}
            {isPdf && photo && (
              <div className="flex items-center gap-3 bg-red-50 rounded-xl p-4">
                <span className="text-3xl">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-[#1A1A1A] truncate">{photo.name}</p>
                  <p className="text-xs text-gray-400">PDF · {(photo.size / 1024).toFixed(0)} KB</p>
                </div>
                <button onClick={() => { handleRemovePhoto(); setUiMode('capture') }} className="text-gray-400 text-sm px-2 py-1">×</button>
              </div>
            )}
            <p className="text-sm text-gray-500 text-center">Extract invoice details automatically?</p>
            <button onClick={handleExtractWithAI}
              className="w-full py-4 rounded-full bg-[#B8960C] text-white font-bold text-base flex items-center justify-center gap-2 shadow-md">
              <span>✨</span><span>Extract with AI</span>
            </button>
            <button onClick={() => setUiMode('form')}
              className="w-full py-3 rounded-full border border-gray-200 text-gray-500 text-sm font-medium">
              Or fill in manually
            </button>
          </div>
        )}

        {/* ── EXTRACTING MODE ── */}
        {uiMode === 'extracting' && (
          <div className="bg-white rounded-2xl p-8 shadow-sm flex flex-col items-center justify-center gap-4">
            <div className="w-10 h-10 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
            <p className="font-semibold text-[#1A1A1A]">Reading invoice with AI…</p>
            <p className="text-sm text-gray-400 text-center">Extracting supplier, invoice number, dates and line items.</p>
          </div>
        )}

        {/* ── FORM MODE ── */}
        {uiMode === 'form' && (
          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
            {/* Hidden file inputs for re-capture from form */}
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
            <input ref={libraryInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileSelect} />

            {/* Photo preview */}
            {photoPreview && !isPdf && (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview} alt="Invoice photo" className="w-full h-36 object-cover rounded-xl" />
                <button onClick={handleRemovePhoto}
                  className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">× Remove</button>
              </div>
            )}
            {isPdf && photo && (
              <div className="flex items-center gap-3 bg-red-50 rounded-xl p-3">
                <span className="text-2xl">📄</span>
                <p className="flex-1 text-sm font-medium text-[#1A1A1A] truncate">{photo.name}</p>
                <button onClick={handleRemovePhoto} className="text-gray-400 text-sm">× Remove</button>
              </div>
            )}
            {!photo && (
              <div className="flex gap-2">
                <button onClick={() => cameraInputRef.current?.click()}
                  className="flex-1 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-400 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors">
                  📷 Camera
                </button>
                <button onClick={() => libraryInputRef.current?.click()}
                  className="flex-1 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-400 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors">
                  🖼️ Library
                </button>
                <button onClick={() => pdfInputRef.current?.click()}
                  className="flex-1 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-400 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors">
                  📄 PDF
                </button>
              </div>
            )}

            {/* AI confidence badge */}
            {aiConfidence && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium ${
                aiConfidence === 'high' ? 'bg-green-50 text-[#16A34A]'
                : aiConfidence === 'medium' ? 'bg-amber-50 text-[#D97706]'
                : 'bg-red-50 text-[#DC2626]'
              }`}>
                <span>✨</span>
                <span>
                  {aiConfidence === 'high' && 'AI extracted · High confidence'}
                  {aiConfidence === 'medium' && 'AI extracted · Medium confidence — please verify'}
                  {aiConfidence === 'low' && 'AI extracted · Low confidence — verify carefully'}
                </span>
              </div>
            )}

            {/* GST flagged warning — shown when AI cannot determine GST treatment.
                This invoice will be saved as xero_sync_status='review' and
                excluded from the 3 PM Xero batch until resolved. */}
            {gstFlagged && (
              <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                <span className="text-amber-500 text-xl shrink-0 mt-0.5">⚠️</span>
                <div>
                  <p className="text-sm font-semibold text-amber-700">GST type unclear — flagged for review</p>
                  <p className="text-xs text-amber-600 mt-0.5 leading-relaxed">
                    This invoice will be saved but held back from Xero sync. Ask your manager to set the correct GST treatment before end of day.
                  </p>
                </div>
              </div>
            )}

            <h2 className="font-semibold text-[#1A1A1A]">Invoice Details</h2>

            {/* Supplier Name */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Supplier Name <span className="text-[#DC2626]">*</span></label>
              <input type="text" value={supplierName} onChange={e => setSupplierName(e.target.value)}
                placeholder="e.g. Fresh Foods Co."
                className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]" />
            </div>

            {/* Supplier Email */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Supplier Email <span className="text-gray-400 font-normal">(optional)</span></label>
              <input type="email" value={supplierEmail} onChange={e => setSupplierEmail(e.target.value)}
                placeholder="billing@supplier.com.au"
                className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]" />
            </div>

            {/* Invoice Number */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Invoice Number <span className="text-[#DC2626]">*</span></label>
              <input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                placeholder="e.g. INV-00123"
                className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]" />
            </div>

            {/* Invoice Date & Due Date side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Invoice Date <span className="text-[#DC2626]">*</span></label>
                <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
                  className="px-3 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Due Date <span className="text-[#DC2626]">*</span></label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="px-3 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]" />
              </div>
            </div>
            {invoiceDate && dueDate && (
              <p className="text-xs text-gray-400 -mt-2">Due date auto-set to 30 days — adjust if needed</p>
            )}

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold tracking-widest uppercase text-gray-400">
                  Line Items <span className="text-[#DC2626]">*</span>
                </p>
                <button onClick={addLineItem}
                  className="w-7 h-7 rounded-full bg-[#B8960C] text-white text-lg flex items-center justify-center leading-none">
                  +
                </button>
              </div>

              <div className="space-y-3">
                {lineItems.map((item, index) => (
                  <div key={index} className="bg-[#FAF8F3] rounded-xl p-3 space-y-2">

                    {/* Row 1: Description + remove button */}
                    <div className="flex items-center gap-2">
                      <input type="text" value={item.description}
                        onChange={e => updateLineItem(index, 'description', e.target.value)}
                        placeholder="Description"
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]" />
                      <button onClick={() => removeLineItem(index)}
                        className="w-7 h-7 rounded-full bg-gray-200 text-gray-500 text-sm flex items-center justify-center shrink-0">×</button>
                    </div>

                    {/* Row 2: Qty | Unit Amount (ex-GST) | Total (calculated) */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex flex-col gap-0.5">
                        <label className="text-xs text-gray-400">Qty</label>
                        <input type="number" step="1" min="0" value={item.quantity}
                          onChange={e => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                          className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]" />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <label className="text-xs text-gray-400">Unit (ex-GST)</label>
                        <input type="number" step="0.01" min="0" value={item.unit_amount}
                          onChange={e => updateLineItem(index, 'unit_amount', parseFloat(e.target.value) || 0)}
                          className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]" />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <label className="text-xs text-gray-400">Line Total</label>
                        <div className="px-3 py-2 rounded-lg border border-gray-100 bg-gray-50 text-sm text-gray-600 font-medium">
                          {formatCurrency(item.quantity * item.unit_amount)}
                        </div>
                      </div>
                    </div>

                    {/* Row 3: Account Code | Inventory Item Code */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-0.5">
                        <label className="text-xs text-gray-400">Account Code</label>
                        <input type="text" value={item.account_code}
                          onChange={e => updateLineItem(index, 'account_code', e.target.value)}
                          placeholder="300"
                          className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]" />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <label className="text-xs text-gray-400">Item Code <span className="font-normal">(opt)</span></label>
                        <input type="text" value={item.inventory_item_code}
                          onChange={e => updateLineItem(index, 'inventory_item_code', e.target.value)}
                          placeholder="SKU or blank"
                          className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Invoice total calculated from line items */}
              {lineItems.length > 0 && (
                <div className="flex items-center justify-between pt-3 mt-2 border-t border-gray-100">
                  <span className="text-sm font-medium text-gray-600">Invoice Total (ex-GST)</span>
                  <span className="text-xl font-bold text-[#1A1A1A]">
                    {formatCurrency(lineItems.reduce((s, i) => s + i.quantity * i.unit_amount, 0))}
                  </span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button onClick={resetForm}
                className="flex-1 py-3 rounded-full border border-gray-200 text-gray-600 text-sm font-medium">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex-1 py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40">
                {submitting ? 'Saving…' : 'Save Invoice'}
              </button>
            </div>
          </div>
        )}

        {/* ── TODAY'S INVOICES ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">
              Today&apos;s Invoices
              {todayInvoices.length > 0 && (
                <span className="ml-1 font-normal normal-case text-gray-400">({todayInvoices.length})</span>
              )}
            </p>
          </div>

          {todayInvoices.length > 0 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">Today&apos;s Total (ex-GST)</span>
              <span className="text-xl font-bold text-[#1A1A1A]">{formatCurrency(todayTotal)}</span>
            </div>
          )}

          {loadingInvoices ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : todayInvoices.length === 0 ? (
            <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
              <p className="text-gray-400 text-sm">No invoices scanned today</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todayInvoices.map(invoice => (
                <div key={invoice.id} className="bg-white rounded-2xl p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[#1A1A1A] truncate">{invoice.supplier_name}</p>

                      <p className="text-xs text-gray-400 mt-0.5">
                        {invoice.reference_number && `#${invoice.reference_number}`}
                        {invoice.reference_number && invoice.invoice_date && ' · '}
                        {invoice.invoice_date && formatDisplayDate(invoice.invoice_date)}
                        {invoice.due_date && ` · Due ${formatDisplayDate(invoice.due_date)}`}
                      </p>

                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-lg font-bold text-[#1A1A1A]">{formatCurrency(invoice.total_amount)}</span>
                        <span className="text-xs text-gray-400">ex-GST</span>

                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          invoice.status === 'submitted' ? 'bg-green-100 text-[#16A34A]' : 'bg-amber-100 text-[#D97706]'
                        }`}>
                          {invoice.status === 'submitted' ? 'Submitted' : 'Pending'}
                        </span>

                        {/* Xero sync status badge */}
                        {invoice.xero_sync_status === 'synced' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-50 text-[#16A34A]">
                            ✓ Xero
                          </span>
                        )}
                        {invoice.xero_sync_status === 'failed' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-[#DC2626]">
                            Xero failed
                          </span>
                        )}
                        {invoice.xero_sync_status === 'review' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-[#D97706]">
                            ⚠️ GST review
                          </span>
                        )}

                        {invoice.ai_confidence && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            invoice.ai_confidence === 'high' ? 'bg-green-50 text-[#16A34A]'
                            : invoice.ai_confidence === 'medium' ? 'bg-amber-50 text-[#D97706]'
                            : 'bg-red-50 text-[#DC2626]'
                          }`}>
                            AI · {invoice.ai_confidence}
                          </span>
                        )}

                        {invoice.line_items?.length > 0 && (
                          <span className="text-xs text-gray-400">
                            {invoice.line_items.length} line item{invoice.line_items.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-gray-400 mt-1">{formatTime(invoice.created_at)}</p>
                    </div>

                    {invoice.photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={invoice.photo_url} alt="Invoice" className="w-12 h-12 object-cover rounded-lg shrink-0" />
                    )}
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
