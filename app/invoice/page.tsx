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

/** Converts a File object to a base64 string for the Claude API */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the data URL prefix (e.g. "data:image/jpeg;base64,")
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Invoice Scanning page — all roles */
export default function InvoicePage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()
  // Separate refs for camera, library, and PDF inputs
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  // Camera / photo / PDF state
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [isPdf, setIsPdf] = useState(false)

  // UI mode states:
  // 'capture' = show camera prompt (no photo yet)
  // 'choose' = photo captured, offer AI or manual choice
  // 'extracting' = AI extraction in progress
  // 'form' = show the form (pre-filled or blank)
  const [uiMode, setUiMode] = useState<'capture' | 'choose' | 'extracting' | 'form'>('capture')

  // AI confidence after extraction
  const [aiConfidence, setAiConfidence] = useState<'high' | 'medium' | 'low' | null>(null)

  // Form fields
  const [supplierName, setSupplierName] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([])

  // Submission state
  const [submitting, setSubmitting] = useState(false)

  // Today's invoices list
  const [todayInvoices, setTodayInvoices] = useState<Invoice[]>([])
  const [loadingInvoices, setLoadingInvoices] = useState(true)

  // Auth guard
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
  }, [profile, loading, router])

  /** Fetch all invoices for today's café day */
  async function fetchTodayInvoices() {
    const supabase = createClient()
    const cafeDay = getCurrentCafeDay()

    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('cafe_day', cafeDay)
      .order('created_at', { ascending: false })

    setTodayInvoices((data as Invoice[]) ?? [])
    setLoadingInvoices(false)
  }

  useEffect(() => {
    if (profile) fetchTodayInvoices()
  }, [profile])

  /** Handle any file selection (photo or PDF) */
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Revoke old preview URL to avoid memory leaks
    if (photoPreview) URL.revokeObjectURL(photoPreview)

    const pdf = file.type === 'application/pdf'
    setIsPdf(pdf)
    setPhoto(file)
    // PDFs can't be shown as an image — store null for preview
    setPhotoPreview(pdf ? null : URL.createObjectURL(file))
    setUiMode('choose')

    // Reset all inputs so the same file can be re-selected
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (libraryInputRef.current) libraryInputRef.current.value = ''
    if (pdfInputRef.current) pdfInputRef.current.value = ''
  }

  /** Remove the selected file and reset to capture mode */
  function handleRemovePhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhoto(null)
    setPhotoPreview(null)
    setIsPdf(false)
  }

  /**
   * Sends the captured photo to the AI extraction API.
   * On success, pre-fills the form with extracted data.
   * On failure, falls through to blank manual entry.
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
        // Specific error for missing API key
        if (data.error === 'Claude API key not configured') {
          showToast('AI extraction not configured — fill in manually', 'info')
        } else {
          showToast(data.error || 'AI extraction failed — fill in manually', 'error')
        }
        // Fall through to blank manual entry
        setUiMode('form')
        return
      }

      // Populate form with extracted data
      setSupplierName(data.supplier_name || '')
      setInvoiceDate(data.invoice_date || '')
      setReferenceNumber(data.reference_number || '')
      setTotalAmount(data.total_amount ? data.total_amount.toString() : '')
      setLineItems(Array.isArray(data.line_items) ? data.line_items : [])
      setAiConfidence(data.confidence || null)

      setUiMode('form')
      showToast('Invoice data extracted — please verify', 'success')
    } catch {
      showToast('AI extraction failed — fill in manually', 'error')
      setUiMode('form')
    }
  }

  /** Switch directly to manual form entry (skips AI) */
  function handleFillManually() {
    setUiMode('form')
  }

  /** Add a blank line item row */
  function addLineItem() {
    setLineItems(prev => [
      ...prev,
      { description: '', quantity: 1, unit_price: 0, total: 0 },
    ])
  }

  /** Update a line item field by index, auto-recalculating total */
  function updateLineItem(index: number, field: keyof LineItem, value: string | number) {
    setLineItems(prev => {
      const updated = [...prev]
      const item = { ...updated[index] }

      if (field === 'description') {
        item.description = value as string
      } else if (field === 'quantity') {
        item.quantity = Number(value) || 0
        item.total = item.quantity * item.unit_price
      } else if (field === 'unit_price') {
        item.unit_price = Number(value) || 0
        item.total = item.quantity * item.unit_price
      }

      updated[index] = item
      return updated
    })
  }

  /** Remove a line item row by index */
  function removeLineItem(index: number) {
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  /** Reset everything back to initial capture state */
  function resetForm() {
    handleRemovePhoto()
    setUiMode('capture')
    setSupplierName('')
    setInvoiceDate('')
    setReferenceNumber('')
    setTotalAmount('')
    setLineItems([])
    setAiConfidence(null)
    setIsPdf(false)
  }

  /** Upload photo to Supabase Storage and return the public URL */
  async function uploadPhoto(file: File, cafeDay: string): Promise<string> {
    const supabase = createClient()
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const path = `${cafeDay}/${filename}`

    const { error } = await supabase.storage
      .from('invoice-photos')
      .upload(path, file)

    if (error) throw new Error(`Photo upload failed: ${error.message}`)

    const { data } = supabase.storage
      .from('invoice-photos')
      .getPublicUrl(path)

    return data.publicUrl
  }

  /** Submit the invoice form */
  async function handleSubmit() {
    if (!profile) return
    if (!supplierName.trim()) {
      showToast('Supplier name is required', 'error')
      return
    }
    const amount = parseFloat(totalAmount)
    if (!totalAmount || isNaN(amount) || amount < 0) {
      showToast('Enter a valid total amount', 'error')
      return
    }

    setSubmitting(true)
    const supabase = createClient()
    const cafeDay = getCurrentCafeDay()

    try {
      // Upload photo if one was selected
      let photoUrl = ''
      if (photo) {
        photoUrl = await uploadPhoto(photo, cafeDay)
      }

      // Save invoice to database — include ai_confidence from extraction if AI was used
      const { error } = await supabase.from('invoices').insert({
        scanned_by: profile.id,
        supplier_name: supplierName.trim(),
        invoice_date: invoiceDate || null,
        reference_number: referenceNumber.trim() || null,
        total_amount: amount,
        line_items: lineItems,
        photo_url: photoUrl,
        ai_confidence: aiConfidence, // null if manual entry, 'high'/'medium'/'low' if AI extracted
        status: 'pending',
        cafe_day: cafeDay,
      })

      if (error) {
        showToast(error.message, 'error')
        return
      }

      showToast('Invoice saved', 'success')
      // Log activity
      await logActivity(
        profile.id,
        'invoice_scanned',
        `Invoice from ${supplierName.trim()}`,
        amount
      )
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

  // Running total of all today's invoices
  const todayTotal = todayInvoices.reduce((sum, inv) => sum + inv.total_amount, 0)

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <button
          onClick={() => router.back()}
          className="text-[#B8960C] text-sm mb-3 flex items-center gap-1"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Scan Invoice</h1>
        <p className="text-sm text-gray-400 mt-1">Capture delivery receipts</p>
      </div>

      <div className="px-5 space-y-6">

        {/* ── Section 1: Capture / Choose / Extracting / Form ── */}

        {/* CAPTURE MODE: no file selected yet */}
        {uiMode === 'capture' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm space-y-3">
            {/* Camera input — opens camera directly on mobile */}
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
            {/* Library input — opens photo library / file picker */}
            <input ref={libraryInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            {/* PDF input */}
            <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileSelect} />

            {/* Take Photo */}
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="w-full flex items-center gap-4 p-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors"
            >
              <span className="text-2xl">📷</span>
              <div className="text-left">
                <p className="font-semibold text-sm">Take Photo</p>
                <p className="text-xs text-gray-400">Open camera to photograph invoice</p>
              </div>
            </button>

            {/* Upload from Library */}
            <button
              onClick={() => libraryInputRef.current?.click()}
              className="w-full flex items-center gap-4 p-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors"
            >
              <span className="text-2xl">🖼️</span>
              <div className="text-left">
                <p className="font-semibold text-sm">Upload from Library</p>
                <p className="text-xs text-gray-400">Choose an existing photo</p>
              </div>
            </button>

            {/* Upload PDF */}
            <button
              onClick={() => pdfInputRef.current?.click()}
              className="w-full flex items-center gap-4 p-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors"
            >
              <span className="text-2xl">📄</span>
              <div className="text-left">
                <p className="font-semibold text-sm">Upload PDF</p>
                <p className="text-xs text-gray-400">Select a PDF invoice file</p>
              </div>
            </button>

            {/* OR divider */}
            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400 font-medium">OR</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Manual entry */}
            <button
              onClick={() => setUiMode('form')}
              className="w-full text-center text-sm text-[#B8960C] font-medium py-2"
            >
              Enter manually (no file)
            </button>
          </div>
        )}

        {/* CHOOSE MODE: file selected — offer AI or manual */}
        {uiMode === 'choose' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
            {/* Photo preview (images only) */}
            {photoPreview && !isPdf && (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Invoice photo"
                  className="w-full h-44 object-cover rounded-xl"
                />
                <button
                  onClick={() => { handleRemovePhoto(); setUiMode('capture') }}
                  className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full"
                >
                  × Retake
                </button>
              </div>
            )}

            {/* PDF file indicator */}
            {isPdf && photo && (
              <div className="flex items-center gap-3 bg-red-50 rounded-xl p-4">
                <span className="text-3xl">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-[#1A1A1A] truncate">{photo.name}</p>
                  <p className="text-xs text-gray-400">PDF · {(photo.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  onClick={() => { handleRemovePhoto(); setUiMode('capture') }}
                  className="text-gray-400 text-sm px-2 py-1"
                >
                  ×
                </button>
              </div>
            )}

            <p className="text-sm text-gray-500 text-center">
              Would you like to extract the invoice details automatically?
            </p>

            {/* Primary: Extract with AI */}
            <button
              onClick={handleExtractWithAI}
              className="w-full py-4 rounded-full bg-[#B8960C] text-white font-bold text-base flex items-center justify-center gap-2 shadow-md"
            >
              <span>✨</span>
              <span>Extract with AI</span>
            </button>

            {/* Secondary: Fill in manually */}
            <button
              onClick={handleFillManually}
              className="w-full py-3 rounded-full border border-gray-200 text-gray-500 text-sm font-medium"
            >
              Or fill in manually
            </button>
          </div>
        )}

        {/* EXTRACTING MODE: AI processing in progress */}
        {uiMode === 'extracting' && (
          <div className="bg-white rounded-2xl p-8 shadow-sm flex flex-col items-center justify-center gap-4">
            <div className="w-10 h-10 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
            <p className="font-semibold text-[#1A1A1A]">Reading invoice with AI…</p>
            <p className="text-sm text-gray-400 text-center">
              This takes a few seconds. Claude is extracting the supplier, total, and line items.
            </p>
          </div>
        )}

        {/* FORM MODE: manual or AI-pre-filled form */}
        {uiMode === 'form' && (
          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">

            {/* Hidden inputs for adding a file from form mode */}
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
            <input ref={libraryInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileSelect} />

            {/* Photo preview */}
            {photoPreview && !isPdf && (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Invoice photo"
                  className="w-full h-36 object-cover rounded-xl"
                />
                <button
                  onClick={handleRemovePhoto}
                  className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full"
                >
                  × Remove
                </button>
              </div>
            )}

            {/* PDF indicator */}
            {isPdf && photo && (
              <div className="flex items-center gap-3 bg-red-50 rounded-xl p-3">
                <span className="text-2xl">📄</span>
                <p className="flex-1 text-sm font-medium text-[#1A1A1A] truncate">{photo.name}</p>
                <button onClick={handleRemovePhoto} className="text-gray-400 text-sm">× Remove</button>
              </div>
            )}

            {/* Add file button if no file yet */}
            {!photo && (
              <div className="flex gap-2">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-400 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors"
                >
                  📷 Camera
                </button>
                <button
                  onClick={() => libraryInputRef.current?.click()}
                  className="flex-1 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-400 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors"
                >
                  🖼️ Library
                </button>
                <button
                  onClick={() => pdfInputRef.current?.click()}
                  className="flex-1 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-400 hover:border-[#B8960C] hover:text-[#B8960C] transition-colors"
                >
                  📄 PDF
                </button>
              </div>
            )}

            {/* AI confidence badge — shown when AI extracted the data */}
            {aiConfidence && (
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium ${
                  aiConfidence === 'high'
                    ? 'bg-green-50 text-[#16A34A]'
                    : aiConfidence === 'medium'
                    ? 'bg-amber-50 text-[#D97706]'
                    : 'bg-red-50 text-[#DC2626]'
                }`}
              >
                <span>✨</span>
                <span>
                  {aiConfidence === 'high' && 'AI extracted · High confidence'}
                  {aiConfidence === 'medium' && 'AI extracted · Medium confidence — please verify'}
                  {aiConfidence === 'low' && 'AI extracted · Low confidence — please verify carefully'}
                </span>
              </div>
            )}

            <h2 className="font-semibold text-[#1A1A1A]">Invoice Details</h2>

            {/* Supplier Name */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">
                Supplier Name <span className="text-[#DC2626]">*</span>
              </label>
              <input
                type="text"
                value={supplierName}
                onChange={e => setSupplierName(e.target.value)}
                placeholder="e.g. Fresh Foods Co."
                className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
              />
            </div>

            {/* Invoice Date */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">
                Invoice Date <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={invoiceDate}
                onChange={e => setInvoiceDate(e.target.value)}
                className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
              />
            </div>

            {/* Reference / Invoice # */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">
                Reference / Invoice # <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={e => setReferenceNumber(e.target.value)}
                placeholder="e.g. INV-00123"
                className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
              />
            </div>

            {/* Total Amount */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">
                Total Amount <span className="text-[#DC2626]">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={totalAmount}
                  onChange={e => setTotalAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                />
              </div>
            </div>

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold tracking-widest uppercase text-gray-400">
                  Line Items <span className="font-normal normal-case">(optional)</span>
                </p>
                <button
                  onClick={addLineItem}
                  className="w-7 h-7 rounded-full bg-[#B8960C] text-white text-lg flex items-center justify-center leading-none"
                >
                  +
                </button>
              </div>

              {lineItems.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">No line items added</p>
              ) : (
                <div className="space-y-2">
                  {lineItems.map((item, index) => (
                    <div key={index} className="bg-[#FAF8F3] rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={item.description}
                          onChange={e => updateLineItem(index, 'description', e.target.value)}
                          placeholder="Description"
                          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                        />
                        <button
                          onClick={() => removeLineItem(index)}
                          className="w-7 h-7 rounded-full bg-gray-200 text-gray-500 text-sm flex items-center justify-center shrink-0"
                        >
                          ×
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 items-center">
                        <div className="flex flex-col gap-0.5">
                          <label className="text-xs text-gray-400">Qty</label>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={item.quantity}
                            onChange={e => updateLineItem(index, 'quantity', e.target.value)}
                            className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-xs text-gray-400">Unit Price</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.unit_price}
                            onChange={e => updateLineItem(index, 'unit_price', e.target.value)}
                            className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-xs text-gray-400">Total</label>
                          <div className="px-3 py-2 rounded-lg border border-gray-100 bg-gray-50 text-sm text-gray-600 font-medium">
                            {formatCurrency(item.total)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={resetForm}
                className="flex-1 py-3 rounded-full border border-gray-200 text-gray-600 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
              >
                {submitting ? 'Saving…' : 'Save Invoice'}
              </button>
            </div>
          </div>
        )}

        {/* ── Section 2: Today's Invoices ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">
              Today&apos;s Invoices
              {todayInvoices.length > 0 && (
                <span className="ml-1 font-normal normal-case text-gray-400">
                  ({todayInvoices.length})
                </span>
              )}
            </p>
          </div>

          {/* Running total */}
          {todayInvoices.length > 0 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">Today&apos;s Total</span>
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

                      {/* Date and reference */}
                      {(invoice.invoice_date || invoice.reference_number) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {invoice.invoice_date && formatDisplayDate(invoice.invoice_date)}
                          {invoice.invoice_date && invoice.reference_number && ' · '}
                          {invoice.reference_number && `#${invoice.reference_number}`}
                        </p>
                      )}

                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {/* Total amount */}
                        <span className="text-lg font-bold text-[#1A1A1A]">
                          {formatCurrency(invoice.total_amount)}
                        </span>

                        {/* Status badge */}
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            invoice.status === 'submitted'
                              ? 'bg-green-100 text-[#16A34A]'
                              : 'bg-amber-100 text-[#D97706]'
                          }`}
                        >
                          {invoice.status === 'submitted' ? 'Submitted' : 'Pending'}
                        </span>

                        {/* AI confidence badge */}
                        {invoice.ai_confidence && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              invoice.ai_confidence === 'high'
                                ? 'bg-green-50 text-[#16A34A]'
                                : invoice.ai_confidence === 'medium'
                                ? 'bg-amber-50 text-[#D97706]'
                                : 'bg-red-50 text-[#DC2626]'
                            }`}
                          >
                            AI · {invoice.ai_confidence}
                          </span>
                        )}

                        {/* Line items count */}
                        {invoice.line_items && invoice.line_items.length > 0 && (
                          <span className="text-xs text-gray-400">
                            {invoice.line_items.length} line item{invoice.line_items.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-gray-400 mt-1">{formatTime(invoice.created_at)}</p>
                    </div>

                    {/* Photo thumbnail */}
                    {invoice.photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={invoice.photo_url}
                        alt="Invoice"
                        className="w-12 h-12 object-cover rounded-lg shrink-0"
                      />
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
