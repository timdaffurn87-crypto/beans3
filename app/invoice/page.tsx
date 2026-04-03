'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useRole } from '@/hooks/useRole'
import { createClient } from '@/lib/supabase'
import { getCurrentCafeDay } from '@/lib/cafe-day'
import { formatCurrency, formatTime, formatDisplayDate } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { logActivity } from '@/lib/activity'
import type { Invoice, LineItem, TaxType } from '@/lib/types'

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

/** A blank line item with Xero defaults — most café items are GST-free food */
function blankLineItem(): LineItem {
  return { description: '', quantity: 1, unit_amount: 0, account_code: '300', inventory_item_code: '', tax_type: 'NONE' as TaxType }
}

// ─── Design tokens (Design tokens for this screen) ─────────────────────
const CI = {
  primary:   '#296861',
  primaryLt: '#73b0a8',
  surface:   '#fdf9f3',
  surfaceCt: '#f1ede7',
  surfaceCtLow: '#f7f3ed',
  surfaceCtHigh: '#ece8e2',
  onSurface: '#1c1c18',
  tertiary:  '#5f5e5e',
  secondary: '#7c5725',
  secondaryCt: '#fecb8e',
  outlineVar: '#bfc9c6',
  gradient: 'linear-gradient(135deg, #296861 0%, #73b0a8 100%)',
}

/** Invoice Scanning page — all roles */
export default function InvoicePage() {
  const { profile, loading } = useAuth()
  const { isManager, isOwner } = useRole()
  const router = useRouter()
  const { showToast } = useToast()
  const canSyncXero = isManager || isOwner
  const cameraInputRef  = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef     = useRef<HTMLInputElement>(null)

  // Incrementing key forces React to remount the file inputs after each selection.
  // On iOS Safari, clearing input.value is not enough to re-trigger the camera —
  // a full remount is the only reliable fix.
  const [fileInputKey, setFileInputKey] = useState(0)

  // File state — supports multiple photos for multi-page invoices
  const [photos, setPhotos]               = useState<File[]>([])
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  // Derived: true when the single attached file is a PDF (PDFs can't be multi-paged here)
  const isPdf = photos.length > 0 && photos[0].type === 'application/pdf'

  // UI mode: capture → choose → extracting → form
  const [uiMode, setUiMode] = useState<'capture' | 'choose' | 'extracting' | 'form'>('capture')

  // AI confidence after extraction
  const [aiConfidence, setAiConfidence] = useState<'high' | 'medium' | 'low' | null>(null)

  // Form fields — aligned to Xero Bill Import columns
  const [supplierName, setSupplierName]   = useState('')   // ContactName
  const [supplierEmail, setSupplierEmail] = useState('')   // EmailAddress
  const [invoiceNumber, setInvoiceNumber] = useState('')   // InvoiceNumber
  const [invoiceDate, setInvoiceDate]     = useState('')   // InvoiceDate (YYYY-MM-DD)
  const [dueDate, setDueDate]             = useState('')   // DueDate (YYYY-MM-DD)
  const [lineItems, setLineItems]         = useState<LineItem[]>([blankLineItem()])

  // Auto-set due date to 30 days after invoice date when invoice date changes
  useEffect(() => {
    if (invoiceDate) {
      setDueDate(prev => prev || addDays(invoiceDate, 30))
    }
  }, [invoiceDate])

  const [submitting, setSubmitting]         = useState(false)
  const [xeroSyncing, setXeroSyncing]       = useState(false)
  const [todayInvoices, setTodayInvoices]   = useState<Invoice[]>([])
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

  /** Handle file selection — appends images, or replaces when a PDF is chosen.
   *  Supports single camera shots and multi-select from library. */
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    const hasPdf = files.some(f => f.type === 'application/pdf')

    if (hasPdf) {
      // PDF replaces everything (already multi-page internally)
      photoPreviews.forEach(url => url && URL.revokeObjectURL(url))
      setPhotos([files[0]])
      setPhotoPreviews([''])
    } else {
      // Images append — clear existing if we're switching away from a PDF
      if (isPdf) {
        photoPreviews.forEach(url => url && URL.revokeObjectURL(url))
        setPhotos(files)
        setPhotoPreviews(files.map(f => URL.createObjectURL(f)))
      } else {
        setPhotos(prev => [...prev, ...files])
        setPhotoPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))])
      }
    }

    setUiMode('choose')
    // Remount all file inputs so iOS re-triggers the camera on the next tap
    setFileInputKey(k => k + 1)
  }

  /** Remove a single photo by index */
  function handleRemovePhoto(index: number) {
    const url = photoPreviews[index]
    if (url) URL.revokeObjectURL(url)
    setPhotos(prev => prev.filter((_, i) => i !== index))
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index))
  }

  /** Clear all photos */
  function handleClearAllPhotos() {
    photoPreviews.forEach(url => url && URL.revokeObjectURL(url))
    setPhotos([])
    setPhotoPreviews([])
  }

  /**
   * Sends all captured photos to the AI extraction API.
   * Pre-fills the form on success; falls through to blank manual entry on failure.
   */
  async function handleExtractWithAI() {
    if (photos.length === 0) return
    setUiMode('extracting')

    try {
      // Convert all files to base64 in parallel
      const images = await Promise.all(
        photos.map(async (file) => ({
          base64: await fileToBase64(file),
          mediaType: file.type,
        }))
      )

      const response = await fetch('/api/ai-extract-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      })
      const data = await response.json()

      if (!response.ok) {
        showToast(data.error || 'AI extraction failed — fill in manually', 'error')
        setUiMode('form')
        return
      }

      setSupplierName(data.supplier_name || '')
      setSupplierEmail(data.supplier_email || '')
      setInvoiceNumber(data.invoice_number || '')
      setInvoiceDate(data.invoice_date || '')
      if (data.due_date) setDueDate(data.due_date)
      else if (data.invoice_date) setDueDate(addDays(data.invoice_date, 30))

      if (Array.isArray(data.line_items) && data.line_items.length > 0) {
        setLineItems(data.line_items.map((item: Partial<LineItem>) => ({
          description:          item.description          || '',
          quantity:             item.quantity             ?? 1,
          unit_amount:          item.unit_amount          ?? 0,
          account_code:         item.account_code         || '300',
          inventory_item_code:  item.inventory_item_code  || '',
          tax_type:             item.tax_type             || 'NONE',
        })))
      } else {
        setLineItems([blankLineItem()])
      }

      setAiConfidence(data.confidence || null)
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
    handleClearAllPhotos()
    setUiMode('capture')
    setSupplierName('')
    setSupplierEmail('')
    setInvoiceNumber('')
    setInvoiceDate('')
    setDueDate('')
    setLineItems([blankLineItem()])
    setAiConfidence(null)
  }

  /**
   * Upload a single file via the server-side /api/upload-photo route,
   * which uses the service role key to bypass storage RLS.
   */
  async function uploadPhoto(file: File, cafeDay: string): Promise<string> {
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const path     = `${cafeDay}/${filename}`

    const formData = new FormData()
    formData.append('file',   file)
    formData.append('bucket', 'invoice-photos')
    formData.append('path',   path)

    const res = await fetch('/api/upload-photo', { method: 'POST', body: formData })
    const json = await res.json()

    if (!res.ok) throw new Error(`Photo upload failed: ${json.error}`)
    return json.url
  }

  /** Save the invoice to the database */
  async function handleSubmit() {
    if (!profile) return

    if (!supplierName.trim())  { showToast('Supplier name is required', 'error');   return }
    if (!invoiceNumber.trim()) { showToast('Invoice number is required', 'error');   return }
    if (!invoiceDate)          { showToast('Invoice date is required', 'error');     return }
    if (!dueDate)              { showToast('Due date is required', 'error');         return }
    if (lineItems.length === 0){ showToast('Add at least one line item', 'error');   return }

    setSubmitting(true)
    const supabase = createClient()
    const cafeDay  = getCurrentCafeDay()

    try {
      // Upload all photos; store first URL in photo_url, extras in additional_photo_urls
      let photoUrl = ''
      const extraUrls: string[] = []
      for (let i = 0; i < photos.length; i++) {
        const url = await uploadPhoto(photos[i], cafeDay)
        if (i === 0) photoUrl = url
        else extraUrls.push(url)
      }

      const totalAmount = lineItems.reduce((sum, item) => sum + (item.quantity * item.unit_amount), 0)

      const { error } = await supabase.from('invoices').insert({
        scanned_by:             profile.id,
        supplier_name:          supplierName.trim(),
        supplier_email:         supplierEmail.trim() || null,
        invoice_date:           invoiceDate,
        due_date:               dueDate,
        reference_number:       invoiceNumber.trim(),
        total_amount:           totalAmount,
        line_items:             lineItems,
        photo_url:              photoUrl,
        additional_photo_urls:  extraUrls.length > 0 ? extraUrls : null,
        ai_confidence:          aiConfidence,
        status:                 'pending',
        cafe_day:               cafeDay,
        xero_sync_status:       'pending',
      })

      if (error) { showToast(error.message, 'error'); return }

      // Upsert line items into inventory_items table (learns tax types + tracks prices)
      try {
        await fetch('/api/inventory/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoice_id: null, // We don't have the invoice ID here — upsert still works
            supplier_name: supplierName.trim(),
            line_items: lineItems,
          }),
        })
      } catch {
        // Non-fatal — invoice is already saved, inventory sync is a bonus
        console.warn('Inventory upsert failed (non-fatal)')
      }

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

  /**
   * Manually triggers the Xero invoice sync for today's pending invoices.
   * Calls the server-side /api/xero/sync route which invokes the edge function.
   */
  async function handleXeroSync() {
    setXeroSyncing(true)
    try {
      const res  = await fetch('/api/xero/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error ?? 'Xero sync failed', 'error')
        return
      }
      const { synced = 0, failed = 0, skipped = 0 } = data
      if (synced === 0 && failed === 0) {
        showToast(skipped > 0 ? `${skipped} invoice(s) need GST review` : 'No pending invoices to sync', 'error')
      } else {
        showToast(
          `Synced ${synced} to Xero${failed > 0 ? ` · ${failed} failed` : ''}`,
          failed > 0 ? 'error' : 'success'
        )
      }
      // Refresh the invoice list to show updated sync statuses
      fetchTodayInvoices()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Xero sync failed — check your connection', 'error')
    } finally {
      setXeroSyncing(false)
    }
  }

  // ─── Loading guard ────────────────────────────────────────────────────────
  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: CI.surface }}>
        <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: CI.primary }} />
      </div>
    )
  }

  const todayTotal = todayInvoices.reduce((sum, inv) => sum + inv.total_amount, 0)

  /** Returns a Xero-sync status badge for invoice list rows */
  function XeroBadge({ inv }: { inv: Invoice }) {
    if (inv.xero_sync_status === 'synced') return (
      <span className="text-[10px] font-semibold uppercase tracking-tight px-2 py-0.5 rounded"
        style={{ backgroundColor: 'rgba(41,104,97,0.12)', color: CI.primary }}>
        Processed
      </span>
    )
    if (inv.xero_sync_status === 'failed') return (
      <span className="text-[10px] font-semibold uppercase tracking-tight px-2 py-0.5 rounded bg-red-100 text-red-700">
        Sync Failed
      </span>
    )
    // pending — show "Verifying" if AI ran, "Pending" otherwise
    return (
      <span className="text-[10px] font-semibold uppercase tracking-tight px-2 py-0.5 rounded"
        style={{ backgroundColor: 'rgba(124,87,37,0.1)', color: CI.secondary }}>
        {inv.ai_confidence ? 'Verifying' : 'Pending'}
      </span>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: CI.surface }}>

      {/* Hidden file inputs — always mounted so refs are available everywhere */}
      <input key={`cam-${fileInputKey}`}  ref={cameraInputRef}  type="file" accept="image/*"         capture="environment" className="hidden" onChange={handleFileSelect} />
      <input key={`lib-${fileInputKey}`}  ref={libraryInputRef} type="file" accept="image/*"         multiple              className="hidden" onChange={handleFileSelect} />
      <input key={`pdf-${fileInputKey}`}  ref={pdfInputRef}     type="file" accept="application/pdf"                       className="hidden" onChange={handleFileSelect} />

      <div className="px-5 pt-12 pb-4 max-w-2xl mx-auto">

        {/* ── Back nav ──────────────────────────────────────────────────── */}
        <button onClick={() => router.back()}
          className="flex items-center gap-1 text-sm mb-6 transition-opacity hover:opacity-70"
          style={{ color: CI.primary }}>
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_back</span>
          Back
        </button>

        {/* ── Editorial header — always visible ─────────────────────────── */}
        <section className="mb-8">
          <h1
            className="text-5xl font-light leading-tight mb-3"
            style={{ fontFamily: 'var(--font-newsreader, Georgia, serif)', color: CI.onSurface }}
          >
            Inventory Intake
          </h1>
          <p className="text-base leading-relaxed" style={{ color: CI.tertiary }}>
            Capture fresh stock receipts or upload digital invoices to keep your artisan stores perfectly balanced.
          </p>
        </section>

        {/* ════════════════════════════════════════════════════════════════
            CAPTURE MODE — Bento action grid
            ════════════════════════════════════════════════════════════════ */}
        {uiMode === 'capture' && (
          <div className="space-y-3 mb-10">

            {/* Camera — primary action, full width, gradient */}
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="relative w-full overflow-hidden rounded-2xl p-7 text-left active:scale-[0.98] transition-transform"
              style={{ background: CI.gradient, boxShadow: '0 24px 48px -12px rgba(28,28,24,0.12)' }}
            >
              {/* Icon */}
              <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-5"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)' }}>
                <span className="material-symbols-outlined text-white" style={{ fontSize: '28px', fontVariationSettings: "'FILL' 1" }}>
                  photo_camera
                </span>
              </div>

              {/* Text */}
              <h2
                className="text-3xl font-light italic text-white mb-1"
                style={{ fontFamily: 'var(--font-newsreader, Georgia, serif)' }}
              >
                Take Photo
              </h2>
              <p className="text-white/75 text-sm max-w-xs">
                Scan receipts with your camera — add multiple pages for longer invoices.
              </p>

              {/* CTA row */}
              <div className="mt-6 flex items-center gap-2 text-white font-medium text-sm">
                <span>Launch Scanner</span>
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
              </div>

              {/* Decorative blob */}
              <div className="absolute -right-10 -bottom-10 w-52 h-52 rounded-full"
                style={{ backgroundColor: 'rgba(255,255,255,0.08)', filter: 'blur(32px)' }} />
            </button>

            {/* Library + PDF — side by side */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => libraryInputRef.current?.click()}
                className="rounded-2xl p-6 text-left active:scale-[0.98] transition-all"
                style={{ backgroundColor: CI.surfaceCt }}
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                  style={{ backgroundColor: 'rgba(41,104,97,0.12)' }}>
                  <span className="material-symbols-outlined" style={{ color: CI.primary }}>add_photo_alternate</span>
                </div>
                <h3
                  className="text-xl font-normal mb-1"
                  style={{ fontFamily: 'var(--font-newsreader, Georgia, serif)', color: CI.onSurface }}
                >
                  Library
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: CI.tertiary }}>
                  Select from your device gallery.
                </p>
              </button>

              <button
                onClick={() => pdfInputRef.current?.click()}
                className="rounded-2xl p-6 text-left active:scale-[0.98] transition-all"
                style={{ backgroundColor: CI.surfaceCt }}
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                  style={{ backgroundColor: 'rgba(41,104,97,0.12)' }}>
                  <span className="material-symbols-outlined" style={{ color: CI.primary }}>picture_as_pdf</span>
                </div>
                <h3
                  className="text-xl font-normal mb-1"
                  style={{ fontFamily: 'var(--font-newsreader, Georgia, serif)', color: CI.onSurface }}
                >
                  Upload PDF
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: CI.tertiary }}>
                  Import digital supplier invoices.
                </p>
              </button>
            </div>

            {/* Manual entry — full width, outlined */}
            <button
              onClick={() => setUiMode('form')}
              className="w-full rounded-2xl p-5 flex items-center justify-between active:scale-[0.98] transition-all"
              style={{
                backgroundColor: CI.surfaceCtLow,
                border: `1px solid ${CI.outlineVar}30`,
              }}
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center">
                  <span className="material-symbols-outlined" style={{ color: CI.secondary }}>edit_note</span>
                </div>
                <div className="text-left">
                  <h3
                    className="text-xl font-normal"
                    style={{ fontFamily: 'var(--font-newsreader, Georgia, serif)', color: CI.onSurface }}
                  >
                    Enter manually
                  </h3>
                  <p className="text-xs" style={{ color: CI.tertiary }}>No document? Log items one by one.</p>
                </div>
              </div>
              <span className="material-symbols-outlined" style={{ color: CI.outlineVar }}>chevron_right</span>
            </button>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            CHOOSE MODE — preview + AI extract option
            ════════════════════════════════════════════════════════════════ */}
        {uiMode === 'choose' && (
          <div className="bg-white rounded-2xl p-6 space-y-4 mb-10"
            style={{ boxShadow: '0 4px 20px rgba(28,28,24,0.06)' }}>

            {/* PDF attachment (single file, no multi-page) */}
            {isPdf && photos[0] && (
              <div className="flex items-center gap-3 rounded-xl p-4"
                style={{ backgroundColor: CI.surfaceCt }}>
                <span className="material-symbols-outlined" style={{ color: CI.primary, fontSize: '28px' }}>description</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate" style={{ color: CI.onSurface }}>{photos[0].name}</p>
                  <p className="text-xs" style={{ color: CI.tertiary }}>PDF · {(photos[0].size / 1024).toFixed(0)} KB</p>
                </div>
                <button onClick={() => { handleClearAllPhotos(); setUiMode('capture') }}
                  className="text-sm px-2 py-1" style={{ color: CI.tertiary }}>×</button>
              </div>
            )}

            {/* Photo thumbnail strip — scrolls horizontally if many pages */}
            {!isPdf && photoPreviews.length > 0 && (
              <div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {photoPreviews.map((preview, idx) => (
                    <div key={idx} className="relative shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview} alt={`Page ${idx + 1}`}
                        className="w-24 h-28 object-cover rounded-xl border-2"
                        style={{ borderColor: CI.outlineVar }} />
                      <button
                        onClick={() => { handleRemovePhoto(idx); if (photos.length <= 1) setUiMode('capture') }}
                        className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-black/70 text-white rounded-full flex items-center justify-center text-xs leading-none">
                        ×
                      </button>
                      <div className="absolute bottom-1 left-1 bg-black/50 text-white text-[9px] font-bold px-1 rounded">
                        {idx + 1}
                      </div>
                    </div>
                  ))}

                  {/* Add another page tiles */}
                  <button
                    onClick={() => cameraInputRef.current?.click()}
                    className="w-24 h-28 shrink-0 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1"
                    style={{ borderColor: CI.outlineVar }}>
                    <span className="material-symbols-outlined" style={{ color: CI.primary, fontSize: '22px' }}>add_a_photo</span>
                    <p className="text-[9px] font-semibold text-center leading-tight" style={{ color: CI.tertiary }}>Camera</p>
                  </button>
                  <button
                    onClick={() => libraryInputRef.current?.click()}
                    className="w-24 h-28 shrink-0 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1"
                    style={{ borderColor: CI.outlineVar }}>
                    <span className="material-symbols-outlined" style={{ color: CI.primary, fontSize: '22px' }}>add_photo_alternate</span>
                    <p className="text-[9px] font-semibold text-center leading-tight" style={{ color: CI.tertiary }}>Library</p>
                  </button>
                </div>
                <p className="text-xs mt-1.5" style={{ color: CI.tertiary }}>
                  {photoPreviews.length} page{photoPreviews.length > 1 ? 's' : ''} captured — add more for multi-page invoices
                </p>
              </div>
            )}

            <p className="text-sm text-center" style={{ color: CI.tertiary }}>
              Extract invoice details automatically with AI?
            </p>
            <button onClick={handleExtractWithAI}
              className="w-full py-4 rounded-full text-white font-semibold text-base flex items-center justify-center gap-2"
              style={{ background: CI.gradient, boxShadow: '0 8px 20px rgba(41,104,97,0.25)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
              Extract with AI
            </button>
            <button onClick={() => setUiMode('form')}
              className="w-full py-3 rounded-full border text-sm font-medium"
              style={{ borderColor: CI.outlineVar, color: CI.tertiary }}>
              Fill in manually
            </button>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            EXTRACTING MODE — AI loading state
            ════════════════════════════════════════════════════════════════ */}
        {uiMode === 'extracting' && (
          <div className="bg-white rounded-2xl p-10 flex flex-col items-center justify-center gap-4 mb-10"
            style={{ boxShadow: '0 4px 20px rgba(28,28,24,0.06)' }}>
            <div className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: CI.primary }} />
            <p className="font-semibold" style={{ color: CI.onSurface,
              fontFamily: 'var(--font-newsreader, Georgia, serif)', fontSize: '1.2rem' }}>
              Reading invoice…
            </p>
            <p className="text-sm text-center" style={{ color: CI.tertiary }}>
              Matching line items to your Xero inventory and chart of accounts.
            </p>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            FORM MODE — invoice detail entry
            ════════════════════════════════════════════════════════════════ */}
        {uiMode === 'form' && (
          <div className="bg-white rounded-2xl p-5 space-y-4 mb-10"
            style={{ boxShadow: '0 4px 20px rgba(28,28,24,0.06)' }}>

            {/* Re-capture mini buttons (shown when no file attached) */}
            {photos.length === 0 && (
              <div className="flex gap-2">
                {[
                  { label: '📷 Camera',  action: () => cameraInputRef.current?.click()  },
                  { label: '🖼️ Library', action: () => libraryInputRef.current?.click() },
                  { label: '📄 PDF',     action: () => pdfInputRef.current?.click()     },
                ].map(btn => (
                  <button key={btn.label} onClick={btn.action}
                    className="flex-1 py-2 border border-dashed rounded-xl text-xs transition-colors"
                    style={{ borderColor: CI.outlineVar, color: CI.tertiary }}>
                    {btn.label}
                  </button>
                ))}
              </div>
            )}

            {/* Multi-photo thumbnail strip */}
            {!isPdf && photoPreviews.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {photoPreviews.map((preview, idx) => (
                  <div key={idx} className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={preview} alt={`Page ${idx + 1}`}
                      className="w-20 h-24 object-cover rounded-xl border"
                      style={{ borderColor: CI.outlineVar }} />
                    <button onClick={() => handleRemovePhoto(idx)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-black/70 text-white rounded-full flex items-center justify-center text-xs leading-none">
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-20 h-24 shrink-0 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1"
                  style={{ borderColor: CI.outlineVar }}>
                  <span className="material-symbols-outlined" style={{ color: CI.primary, fontSize: '20px' }}>add_a_photo</span>
                  <p className="text-[9px]" style={{ color: CI.tertiary }}>Camera</p>
                </button>
                <button
                  onClick={() => libraryInputRef.current?.click()}
                  className="w-20 h-24 shrink-0 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1"
                  style={{ borderColor: CI.outlineVar }}>
                  <span className="material-symbols-outlined" style={{ color: CI.primary, fontSize: '20px' }}>add_photo_alternate</span>
                  <p className="text-[9px]" style={{ color: CI.tertiary }}>Library</p>
                </button>
              </div>
            )}

            {/* PDF attachment row */}
            {isPdf && photos[0] && (
              <div className="flex items-center gap-3 rounded-xl p-3" style={{ backgroundColor: CI.surfaceCt }}>
                <span className="material-symbols-outlined" style={{ color: CI.primary }}>description</span>
                <p className="flex-1 text-sm font-medium truncate" style={{ color: CI.onSurface }}>{photos[0].name}</p>
                <button onClick={() => handleClearAllPhotos()} className="text-sm" style={{ color: CI.tertiary }}>× Remove</button>
              </div>
            )}

            {/* AI confidence badge */}
            {aiConfidence && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium ${
                aiConfidence === 'high'   ? 'bg-green-50 text-green-700'
                : aiConfidence === 'medium' ? 'bg-amber-50 text-amber-700'
                : 'bg-red-50 text-red-700'
              }`}>
                <span className="material-symbols-outlined" style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                <span>
                  {aiConfidence === 'high'   && 'AI extracted · High confidence'}
                  {aiConfidence === 'medium' && 'AI extracted · Medium confidence — please verify'}
                  {aiConfidence === 'low'    && 'AI extracted · Low confidence — verify carefully'}
                </span>
              </div>
            )}

            <h2 className="font-semibold" style={{ color: CI.onSurface,
              fontFamily: 'var(--font-newsreader, Georgia, serif)', fontSize: '1.15rem' }}>
              Invoice Details
            </h2>

            {/* ── Form fields ── */}
            {[
              { label: 'Supplier Name', required: true,  type: 'text',  value: supplierName,   onChange: (v: string) => setSupplierName(v),   placeholder: 'e.g. Fresh Foods Co.'       },
              { label: 'Supplier Email', required: false, type: 'email', value: supplierEmail,  onChange: (v: string) => setSupplierEmail(v),  placeholder: 'billing@supplier.com.au'    },
              { label: 'Invoice Number', required: true,  type: 'text',  value: invoiceNumber,  onChange: (v: string) => setInvoiceNumber(v),  placeholder: 'e.g. INV-00123'             },
            ].map(f => (
              <div key={f.label} className="flex flex-col gap-1">
                <label className="text-sm font-medium" style={{ color: CI.onSurface }}>
                  {f.label} {f.required && <span className="text-red-500">*</span>}
                  {!f.required && <span className="font-normal" style={{ color: CI.tertiary }}> (optional)</span>}
                </label>
                <input type={f.type} value={f.value} onChange={e => f.onChange(e.target.value)}
                  placeholder={f.placeholder}
                  className="px-4 py-3 rounded-xl border text-base focus:outline-none focus:ring-2"
                  style={{
                    borderColor: CI.outlineVar,
                    backgroundColor: CI.surfaceCtLow,
                    color: CI.onSurface,
                  }}
                />
              </div>
            ))}

            {/* Date fields */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Invoice Date', value: invoiceDate, onChange: setInvoiceDate },
                { label: 'Due Date',     value: dueDate,     onChange: setDueDate     },
              ].map(f => (
                <div key={f.label} className="flex flex-col gap-1">
                  <label className="text-sm font-medium" style={{ color: CI.onSurface }}>
                    {f.label} <span className="text-red-500">*</span>
                  </label>
                  <input type="date" value={f.value} onChange={e => f.onChange(e.target.value)}
                    className="px-3 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2"
                    style={{ borderColor: CI.outlineVar, backgroundColor: CI.surfaceCtLow, color: CI.onSurface }} />
                </div>
              ))}
            </div>
            {invoiceDate && dueDate && (
              <p className="text-xs -mt-2" style={{ color: CI.tertiary }}>
                Due date auto-set to 30 days — adjust if needed
              </p>
            )}

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="section-label">
                  Line Items <span className="text-red-500">*</span>
                </p>
                <button onClick={addLineItem}
                  className="w-7 h-7 rounded-full text-white text-lg flex items-center justify-center leading-none"
                  style={{ backgroundColor: CI.primary }}>
                  +
                </button>
              </div>

              <div className="space-y-3">
                {lineItems.map((item, index) => (
                  <div key={index} className="rounded-xl p-3 space-y-2" style={{ backgroundColor: CI.surfaceCtLow }}>
                    <div className="flex items-center gap-2">
                      <input type="text" value={item.description}
                        onChange={e => updateLineItem(index, 'description', e.target.value)}
                        placeholder="Description"
                        className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2"
                        style={{ borderColor: CI.outlineVar, color: CI.onSurface }} />
                      <button onClick={() => removeLineItem(index)}
                        className="w-7 h-7 rounded-full bg-gray-200 text-gray-500 text-sm flex items-center justify-center shrink-0">
                        ×
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Qty',        value: item.quantity,    onChange: (v: number) => updateLineItem(index, 'quantity', v),    step: '1',    min: '0' },
                        { label: 'Unit Price',  value: item.unit_amount, onChange: (v: number) => updateLineItem(index, 'unit_amount', v), step: '0.01', min: '0' },
                      ].map(f => (
                        <div key={f.label} className="flex flex-col gap-0.5">
                          <label className="text-xs" style={{ color: CI.tertiary }}>{f.label}</label>
                          <input type="number" step={f.step} min={f.min} value={f.value}
                            onChange={e => f.onChange(parseFloat(e.target.value) || 0)}
                            className="px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2"
                            style={{ borderColor: CI.outlineVar, color: CI.onSurface }} />
                        </div>
                      ))}
                      <div className="flex flex-col gap-0.5">
                        <label className="text-xs" style={{ color: CI.tertiary }}>Line Total</label>
                        <div className="px-3 py-2 rounded-lg border text-sm font-medium"
                          style={{ borderColor: CI.outlineVar, backgroundColor: CI.surfaceCt, color: CI.primary }}>
                          {formatCurrency(item.quantity * item.unit_amount)}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex flex-col gap-0.5">
                        <label className="text-xs" style={{ color: CI.tertiary }}>Account Code</label>
                        <input type="text" value={item.account_code} onChange={e => updateLineItem(index, 'account_code', e.target.value)}
                          placeholder="310"
                          className="px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2"
                          style={{ borderColor: CI.outlineVar, color: CI.onSurface }} />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <label className="text-xs" style={{ color: CI.tertiary }}>Item Code</label>
                        <input type="text" value={item.inventory_item_code} onChange={e => updateLineItem(index, 'inventory_item_code', e.target.value)}
                          placeholder="optional"
                          className="px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2"
                          style={{ borderColor: CI.outlineVar, color: CI.onSurface }} />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <label className="text-xs" style={{ color: CI.tertiary }}>Tax Type</label>
                        <select
                          value={item.tax_type}
                          onChange={e => updateLineItem(index, 'tax_type', e.target.value as TaxType)}
                          className="px-2 py-2 rounded-lg border text-sm font-semibold appearance-none bg-white focus:outline-none focus:ring-2"
                          style={{
                            borderColor: item.tax_type === 'INPUT2' ? CI.primary
                              : item.tax_type === 'BASEXCLUDED' ? CI.secondary
                              : CI.outlineVar,
                            backgroundColor: item.tax_type === 'INPUT2' ? 'rgba(41,104,97,0.1)'
                              : item.tax_type === 'BASEXCLUDED' ? 'rgba(124,87,37,0.1)'
                              : 'white',
                            color: item.tax_type === 'INPUT2' ? CI.primary
                              : item.tax_type === 'BASEXCLUDED' ? CI.secondary
                              : CI.tertiary,
                          }}>
                          <option value="NONE">GST Free</option>
                          <option value="INPUT2">10% GST</option>
                          <option value="BASEXCLUDED">BAS Excluded</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {lineItems.length > 0 && (
                <div className="flex items-center justify-between pt-3 mt-2 border-t" style={{ borderColor: CI.outlineVar + '40' }}>
                  <span className="text-sm font-medium" style={{ color: CI.tertiary }}>Invoice Total (inc. GST)</span>
                  <span className="text-xl font-bold"
                    style={{ fontFamily: 'var(--font-newsreader, Georgia, serif)', color: CI.onSurface }}>
                    {formatCurrency(lineItems.reduce((s, i) => s + i.quantity * i.unit_amount, 0))}
                  </span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button onClick={resetForm}
                className="flex-1 py-3 rounded-full border text-sm font-medium"
                style={{ borderColor: CI.outlineVar, color: CI.tertiary }}>
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex-1 py-3 rounded-full text-white font-semibold disabled:opacity-40 transition-opacity"
                style={{ background: CI.gradient }}>
                {submitting ? 'Saving…' : 'Save Invoice'}
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            TODAY'S INVOICES
            ════════════════════════════════════════════════════════════════ */}
        <section>
          <div className="flex items-end justify-between mb-6 gap-3">
            <div>
              <h2
                className="text-3xl font-light italic"
                style={{ fontFamily: 'var(--font-newsreader, Georgia, serif)', color: CI.onSurface }}
              >
                Today&apos;s Invoices
              </h2>
              {todayInvoices.length > 0 && (
                <span className="section-label">{formatCurrency(todayTotal)} total</span>
              )}
            </div>

            {/* Push to Xero — manager/owner only, shown when there are invoices */}
            {canSyncXero && todayInvoices.length > 0 && (
              <button
                onClick={handleXeroSync}
                disabled={xeroSyncing}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 transition-opacity"
                style={{ background: CI.gradient }}
              >
                {xeroSyncing ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Syncing…
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined" style={{ fontSize: '14px', fontVariationSettings: "'FILL' 1" }}>sync</span>
                    Push to Xero
                  </>
                )}
              </button>
            )}
          </div>

          {loadingInvoices ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-4 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: CI.primary }} />
            </div>
          ) : todayInvoices.length === 0 ? (
            <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: CI.surfaceCtLow }}>
              <span className="material-symbols-outlined mb-3 block" style={{ color: CI.outlineVar, fontSize: '36px' }}>
                receipt_long
              </span>
              <p className="text-sm" style={{ color: CI.tertiary }}>No invoices scanned today</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayInvoices.map(invoice => (
                <div key={invoice.id}
                  className="rounded-xl p-4 flex items-center justify-between transition-colors"
                  style={{ backgroundColor: CI.surfaceCtLow }}
                >
                  {/* Thumbnail */}
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 flex items-center justify-center"
                      style={{ backgroundColor: CI.surfaceCtHigh }}>
                      {invoice.photo_url
                        ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={invoice.photo_url} alt="Invoice" className="w-full h-full object-cover opacity-70" />
                        ) : (
                          <span className="material-symbols-outlined" style={{ color: CI.outlineVar }}>description</span>
                        )}
                    </div>

                    {/* Meta */}
                    <div className="min-w-0">
                      <p className="font-semibold truncate" style={{ color: CI.onSurface }}>
                        {invoice.supplier_name}
                      </p>
                      <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: CI.tertiary }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>schedule</span>
                        {formatTime(invoice.created_at)}
                        {invoice.reference_number && ` · #${invoice.reference_number}`}
                      </p>
                    </div>
                  </div>

                  {/* Amount + badge */}
                  <div className="text-right shrink-0 ml-3">
                    <p
                      className="text-lg font-medium"
                      style={{ fontFamily: 'var(--font-newsreader, Georgia, serif)', color: CI.primary }}
                    >
                      {formatCurrency(invoice.total_amount)}
                    </p>
                    <div className="mt-0.5">
                      <XeroBadge inv={invoice} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
