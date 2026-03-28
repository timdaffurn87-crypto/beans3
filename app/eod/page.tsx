'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { getCurrentCafeDay } from '@/lib/cafe-day'
import { formatCurrency, formatTime, formatDisplayDate } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { logActivity } from '@/lib/activity'
import type { DailyTask, WasteLog, Invoice } from '@/lib/types'

/** Shape of a calibration row — we only need the timestamp */
interface CalibrationRow {
  created_at: string
}

/** Converts YYYY-MM-DD to DD/MM/YYYY for Xero */
function toXeroDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

/** Wraps a CSV cell value in quotes if it contains commas, quotes, or newlines */
function csvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Generates a Xero Bill Import CSV string from an array of invoices.
 * Each line item becomes one row. Invoices with no line items are skipped.
 * Required Xero columns are populated; optional address and tracking fields are left blank.
 */
function generateXeroCSV(invoices: Invoice[], cafeDay: string): string {
  const headers = [
    'ContactName', 'EmailAddress',
    'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4',
    'POCity', 'PORegion', 'POPostalCode', 'POCountry',
    'InvoiceNumber', 'InvoiceDate', 'DueDate',
    'InventoryItemCode', 'Description', 'Quantity', 'UnitAmount',
    'AccountCode', 'TaxType',
    'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2',
    'Currency',
  ]

  const rows: string[] = [headers.join(',')]

  for (const invoice of invoices) {
    if (!invoice.line_items || invoice.line_items.length === 0) continue

    for (const item of invoice.line_items) {
      const row = [
        csvCell(invoice.supplier_name),
        csvCell(invoice.supplier_email || ''),
        '', '', '', '', '', '', '', '',               // PO address — blank
        csvCell(invoice.reference_number || ''),
        csvCell(toXeroDate(invoice.invoice_date)),
        csvCell(toXeroDate(invoice.due_date)),
        csvCell(item.inventory_item_code || ''),
        csvCell(item.description),
        String(item.quantity),
        String(item.unit_amount),
        csvCell(item.account_code || '300'),
        'GST on Expenses',
        '', '', '', '',                               // tracking — blank
        'AUD',
      ]
      rows.push(row.join(','))
    }
  }

  // If no invoices had line items, add a comment row so the file isn't empty
  if (rows.length === 1) {
    rows.push(`# No invoices with line items on ${cafeDay}`)
  }

  return rows.join('\n')
}

/**
 * Calculates calibration compliance for the café day.
 *
 * A "gap" is any period without a calibration that exceeds 60 minutes.
 * Compliance % = (total café-day minutes – uncovered minutes) / total minutes × 100.
 * The café day window defaults to 05:30–15:00 AEST (570 minutes).
 */
function calculateCalibrationCompliance(
  calibrationTimes: string[], // ISO timestamps, sorted ascending
  cafeDayStart = '05:30',
  cafeDayEnd = '15:00'
): {
  pct: number
  gaps: { gap_start: string; gap_end: string; duration_minutes: number }[]
} {
  const [startH, startM] = cafeDayStart.split(':').map(Number)
  const [endH, endM] = cafeDayEnd.split(':').map(Number)
  const totalMinutes = endH * 60 + endM - (startH * 60 + startM) // 570 min

  if (calibrationTimes.length === 0) {
    return { pct: 0, gaps: [] }
  }

  const gaps: { gap_start: string; gap_end: string; duration_minutes: number }[] = []
  let uncoveredMinutes = 0

  // Use the first calibration's date to anchor the café day start time
  const firstCal = new Date(calibrationTimes[0])
  const cafeStartDate = new Date(firstCal)
  cafeStartDate.setHours(startH, startM, 0, 0)

  // Gap from café day start to first calibration
  const minutesToFirst = (firstCal.getTime() - cafeStartDate.getTime()) / 1000 / 60
  if (minutesToFirst > 60) {
    gaps.push({
      gap_start: cafeStartDate.toISOString(),
      gap_end: calibrationTimes[0],
      duration_minutes: Math.round(minutesToFirst),
    })
    uncoveredMinutes += minutesToFirst - 60
  }

  // Gaps between consecutive calibrations
  for (let i = 0; i < calibrationTimes.length - 1; i++) {
    const t1 = new Date(calibrationTimes[i])
    const t2 = new Date(calibrationTimes[i + 1])
    const gapMinutes = (t2.getTime() - t1.getTime()) / 1000 / 60

    if (gapMinutes > 60) {
      gaps.push({
        gap_start: calibrationTimes[i],
        gap_end: calibrationTimes[i + 1],
        duration_minutes: Math.round(gapMinutes),
      })
      uncoveredMinutes += gapMinutes - 60
    }
  }

  const rawPct = ((totalMinutes - uncoveredMinutes) / totalMinutes) * 100
  const pct = Math.min(100, Math.max(0, Math.round(rawPct)))
  return { pct, gaps }
}

/** End of Day Report page — all roles */
export default function EODPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()

  const cafeDay = getCurrentCafeDay()

  // Day data
  const [tasks, setTasks] = useState<DailyTask[]>([])
  const [wasteLogs, setWasteLogs] = useState<WasteLog[]>([])
  const [calibrationRows, setCalibrationRows] = useState<CalibrationRow[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])

  // Whether an EOD report was already submitted today
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)

  // Loading states
  const [loadingData, setLoadingData] = useState(true)

  // Submission UI
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false) // shows success screen
  const [showIncompleteWarning, setShowIncompleteWarning] = useState(false)

  // Till balance — cash/EFTPOS totals for recording daily takings
  const [cashTotal, setCashTotal] = useState('')
  const [eftposTotal, setEftposTotal] = useState('')
  const [tillFloat, setTillFloat] = useState<number | null>(null)

  // Till reconciliation — explicit accountability: did the till balance?
  // null = not yet answered; true = balanced; false = discrepancy
  const [tillBalanced, setTillBalanced] = useState<boolean | null>(null)
  const [tillDiscrepancyAmount, setTillDiscrepancyAmount] = useState('')
  const [tillExplanation, setTillExplanation] = useState('')

  // Captured after submit so the success screen can show the right message
  const [submittedBalanced, setSubmittedBalanced] = useState<boolean | null>(null)

  // Auth guard
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
  }, [profile, loading, router])

  /** Load all café-day data needed for the EOD summary */
  async function fetchDayData() {
    const supabase = createClient()

    const [tasksRes, wasteRes, calRes, invoicesRes, eodRes, floatRes] = await Promise.all([
      supabase.from('daily_tasks').select('*').eq('cafe_day', cafeDay),
      supabase.from('waste_logs').select('*').eq('cafe_day', cafeDay),
      supabase
        .from('calibrations')
        .select('created_at')
        .eq('cafe_day', cafeDay)
        .order('created_at', { ascending: true }),
      supabase.from('invoices').select('*').eq('cafe_day', cafeDay),
      supabase
        .from('eod_reports')
        .select('id')
        .eq('cafe_day', cafeDay)
        .single(),
      supabase
        .from('settings')
        .select('value')
        .eq('key', 'till_float')
        .single(),
    ])

    setTasks((tasksRes.data as DailyTask[]) ?? [])
    setWasteLogs((wasteRes.data as WasteLog[]) ?? [])
    setCalibrationRows((calRes.data as CalibrationRow[]) ?? [])
    setInvoices((invoicesRes.data as Invoice[]) ?? [])
    setAlreadySubmitted(!!eodRes.data)
    if (floatRes.data?.value) setTillFloat(parseFloat(floatRes.data.value))
    setLoadingData(false)
  }

  useEffect(() => {
    if (profile) fetchDayData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  /** Begin submission — validate till reconciliation, then warn about incomplete tasks */
  function handleSubmitClick() {
    // Till reconciliation is required before closing the day
    if (tillBalanced === null) {
      showToast('Please confirm whether the till balanced', 'error')
      return
    }
    if (tillBalanced === false) {
      if (!tillDiscrepancyAmount.trim() || isNaN(parseFloat(tillDiscrepancyAmount))) {
        showToast('Enter the discrepancy amount', 'error')
        return
      }
      if (!tillExplanation.trim()) {
        showToast('Add an explanation for the discrepancy', 'error')
        return
      }
    }

    if (incompleteTasks.length > 0) {
      setShowIncompleteWarning(true)
    } else {
      submitEOD()
    }
  }

  /** Perform the actual EOD submit */
  async function submitEOD() {
    if (!profile) return
    setShowIncompleteWarning(false)
    setSubmitting(true)

    const supabase = createClient()

    try {
      // 1. Build notes — append till takings summary if entered
      let fullNotes = notes.trim()
      if (tillEntered) {
        const tillNote = `TILL — Cash: ${formatCurrency(cashNum)} | EFTPOS: ${formatCurrency(eftposNum)} | Total: ${formatCurrency(tillTotal)}`
        fullNotes = fullNotes ? `${fullNotes}\n\n${tillNote}` : tillNote
      }

      // 2. Save the EOD report
      const reportPayload = {
        submitted_by: profile.id,
        cafe_day: cafeDay,
        tasks_completed: tasksCompleted,
        tasks_total: tasksTotal,
        waste_total_value: wasteTotalValue,
        waste_top_items: wasteTopItems,
        calibration_count: calibrationCount,
        calibration_compliance_pct: compliancePct,
        calibration_gaps: gaps.length > 0 ? gaps : null,
        invoices_count: invoicesCount,
        invoices_total_value: invoicesTotalValue,
        invoice_ids: invoiceIds,
        notes: fullNotes || null,
      }

      // Upsert so resubmitting the same café day overwrites the existing record
      const { error: insertError } = await supabase
        .from('eod_reports')
        .upsert(reportPayload, { onConflict: 'cafe_day' })

      if (insertError) {
        showToast(insertError.message, 'error')
        return
      }

      // 2. Mark all today's invoices as submitted
      await supabase
        .from('invoices')
        .update({ status: 'submitted' })
        .eq('cafe_day', cafeDay)

      // 3. Save till reconciliation record — upsert so resubmit overwrites the previous entry
      await supabase.from('till_reconciliation').upsert({
        cafe_day: cafeDay,
        logged_by: profile.id,
        balanced: tillBalanced,
        discrepancy_amount: tillBalanced === false ? parseFloat(tillDiscrepancyAmount) : null,
        explanation: tillBalanced === false ? tillExplanation.trim() : null,
      }, { onConflict: 'cafe_day' })
      // Capture for success screen
      setSubmittedBalanced(tillBalanced)

      // 4. Log activity
      await logActivity(profile.id, 'eod_submitted', `EOD report submitted for ${cafeDay}`)

      // 5. Generate Xero Bill Import CSV from today's invoices and send EOD email
      const xeroCSV = generateXeroCSV(invoices, cafeDay)
      await fetch('/api/eod-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...reportPayload, xero_csv: xeroCSV, xero_csv_filename: `Beans-Invoices-${cafeDay}.csv` }),
      })

      // 6. Show success screen
      setSubmitted(true)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  /** Sign out and go to login after EOD submission */
  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  /**
   * Resubmit — re-fetches all café day data so the summary reflects any
   * changes made since the last submit (e.g. additional waste entries, tasks
   * completed, invoices scanned), then resets UI state so the form is editable again.
   */
  async function handleResubmit() {
    setSubmitted(false)
    setAlreadySubmitted(false)
    setTillBalanced(null)
    setTillDiscrepancyAmount('')
    setTillExplanation('')
    setSubmittedBalanced(null)
    setNotes('')
    setLoadingData(true)
    await fetchDayData()
  }

  // ─── Computed values ───────────────────────────────────────────────────────

  const tasksCompleted = tasks.filter(t => t.completed_at).length
  const tasksTotal = tasks.length
  const incompleteTasks = tasks.filter(t => !t.completed_at)

  const wasteTotalValue = wasteLogs.reduce((sum, w) => sum + w.total_cost, 0)
  const wasteTopItems = [...wasteLogs]
    .sort((a, b) => b.total_cost - a.total_cost)
    .slice(0, 3)
    .map(w => ({ item_name: w.item_name, total_cost: w.total_cost, quantity: w.quantity }))

  const calibrationCount = calibrationRows.length
  const calibrationTimes = calibrationRows.map(c => c.created_at)
  const { pct: compliancePct, gaps } = calculateCalibrationCompliance(calibrationTimes)

  const invoicesCount = invoices.length
  const invoicesTotalValue = invoices.reduce((sum, i) => sum + i.total_amount, 0)
  const invoiceIds = invoices.map(i => i.id)

  // ─── Till balance computed values ────────────────────────────────────────
  // How this works:
  // - The float is the opening cash (set in Settings). It stays in the till all day.
  // - Cash sales accumulate in the till on top of the float during the shift.
  // - At EOD, staff remove cash sales to the safe, leaving only the float.
  // - Cash Counted = what's physically in the till at close (should equal float).
  // - Cash Sales = Cash Counted − Float (what was taken today before banking).
  //   NOTE: if the café banks mid-shift, Cash Counted may equal Float already.
  //   We use Cash Counted directly for Total Takings alongside EFTPOS.
  // - Variance = Cash Counted − Float → anything non-zero is a discrepancy.
  const cashNum = parseFloat(cashTotal) || 0
  const eftposNum = parseFloat(eftposTotal) || 0
  const cashSales = tillFloat !== null && cashTotal !== '' ? Math.max(0, cashNum - tillFloat) : cashNum
  // Total Takings = cash sales (cash above float) + EFTPOS
  const tillTotal = (tillFloat !== null && cashTotal !== '' ? cashSales : cashNum) + eftposNum
  const tillEntered = cashTotal !== '' || eftposTotal !== ''
  // Variance: how much cash counted differs from the expected float
  const cashVariance = tillFloat !== null && cashTotal !== '' ? cashNum - tillFloat : null
  // True discrepancy: variance exists and is non-zero (beyond rounding)
  const tillIsDiscrepancy = cashVariance !== null && Math.abs(cashVariance) > 0.01

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ── Already submitted today ──────────────────────────────────────────────
  if (alreadySubmitted) {
    return (
      <div className="min-h-screen pb-24 flex flex-col" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="px-5 pt-12 pb-6">
          <button
            onClick={() => router.back()}
            className="text-[#B8960C] text-sm mb-3 flex items-center gap-1"
          >
            ← Back
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center px-5">
          <div className="bg-white rounded-2xl p-8 shadow-sm text-center w-full max-w-sm">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-8 h-8 text-[#16A34A]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">Day Closed</h2>
            <p className="text-sm text-gray-500">
              The EOD report for{' '}
              <span className="font-medium text-[#1A1A1A]">{formatDisplayDate(cafeDay)}</span> has
              already been submitted.
            </p>
            <button
              onClick={() => router.push('/')}
              className="mt-6 w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold"
            >
              Back to Dashboard
            </button>
            <button
              onClick={handleResubmit}
              className="mt-3 w-full py-3 rounded-full border border-gray-200 text-gray-600 text-sm font-medium"
            >
              Resubmit for Today
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Submitted successfully this session ──────────────────────────────────
  if (submitted) {
    const hasDiscrepancy = submittedBalanced === false
    return (
      <div
        className="min-h-screen flex items-center justify-center pb-24"
        style={{ backgroundColor: '#FAF8F3' }}
      >
        <div className="px-5 w-full max-w-sm space-y-3">
          {/* Main confirmation card */}
          <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
              hasDiscrepancy ? 'bg-red-100' : 'bg-green-100'
            }`}>
              {hasDiscrepancy ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-[#DC2626]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-[#16A34A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
            </div>
            <h2 className="text-2xl font-bold text-[#1A1A1A] mb-2">Day Closed</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              {hasDiscrepancy
                ? 'Report submitted. The till discrepancy has been logged and the owner has been notified.'
                : 'Great shift. Report submitted and emailed to the owner.'}
            </p>
            {hasDiscrepancy && (
              <div className="mt-4 px-4 py-3 bg-red-50 rounded-xl text-left">
                <p className="text-xs font-semibold text-[#DC2626] uppercase tracking-wide mb-1">Discrepancy logged</p>
                <p className="text-sm text-[#1A1A1A] font-medium">
                  {parseFloat(tillDiscrepancyAmount) > 0 ? '+' : ''}{formatCurrency(parseFloat(tillDiscrepancyAmount))}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{tillExplanation}</p>
              </div>
            )}
            <button
              onClick={handleSignOut}
              className="mt-6 w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold"
            >
              Back to Login
            </button>
            <button
              onClick={handleResubmit}
              className="mt-3 w-full py-3 rounded-full border border-gray-200 text-gray-600 text-sm font-medium"
            >
              Resubmit for Today
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main EOD page ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>

      {/* Incomplete tasks warning modal */}
      {showIncompleteWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-5">
          <div className="bg-white rounded-2xl p-6 shadow-xl w-full max-w-sm">
            <h3 className="text-base font-bold text-[#1A1A1A] mb-2">Incomplete Tasks</h3>
            <p className="text-sm text-gray-600 mb-4">
              You have{' '}
              <span className="font-semibold text-[#D97706]">
                {incompleteTasks.length} incomplete task{incompleteTasks.length !== 1 ? 's' : ''}
              </span>
              . Submit anyway?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowIncompleteWarning(false)}
                className="flex-1 py-3 rounded-full border border-gray-200 text-gray-600 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={submitEOD}
                className="flex-1 py-3 rounded-full bg-[#B8960C] text-white font-semibold text-sm"
              >
                Submit Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <button
          onClick={() => router.back()}
          className="text-[#B8960C] text-sm mb-3 flex items-center gap-1"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">End of Day</h1>
        <p className="text-sm text-gray-400 mt-1">{formatDisplayDate(cafeDay)}</p>
      </div>

      <div className="px-5 space-y-4">

        {/* ── Tasks summary ── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="section-label mb-3">Tasks</p>

          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">
              {tasksCompleted} of {tasksTotal} completed
            </span>
            <span
              className={`text-sm font-semibold ${
                tasksTotal === 0
                  ? 'text-gray-400'
                  : tasksCompleted === tasksTotal
                  ? 'text-[#16A34A]'
                  : 'text-[#D97706]'
              }`}
            >
              {tasksTotal === 0
                ? '—'
                : `${Math.round((tasksCompleted / tasksTotal) * 100)}%`}
            </span>
          </div>

          {/* Progress bar */}
          {tasksTotal > 0 && (
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(tasksCompleted / tasksTotal) * 100}%`,
                  backgroundColor:
                    tasksCompleted === tasksTotal ? '#16A34A' : '#D97706',
                }}
              />
            </div>
          )}

          {/* Incomplete task list warning */}
          {incompleteTasks.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-[#D97706] mb-1.5">Incomplete tasks:</p>
              <ul className="space-y-0.5">
                {incompleteTasks.map(t => (
                  <li key={t.id} className="text-xs text-gray-600 flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0 text-[#D97706]">·</span>
                    {t.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Waste summary ── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="section-label mb-3">Waste</p>

          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-600">Total</span>
            <span className="text-lg font-bold text-[#DC2626]">
              {formatCurrency(wasteTotalValue)}
            </span>
          </div>

          {wasteTopItems.length > 0 && (
            <div className="space-y-1.5">
              {wasteTopItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 truncate flex-1 mr-2">{item.item_name}</span>
                  <span className="text-sm font-medium text-[#1A1A1A] shrink-0">
                    {formatCurrency(item.total_cost)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {wasteLogs.length === 0 && (
            <p className="text-sm text-gray-400">No waste logged today</p>
          )}
        </div>

        {/* ── Calibration summary ── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="section-label mb-3">Calibration</p>

          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">
              {calibrationCount} calibration{calibrationCount !== 1 ? 's' : ''} logged
            </span>
            <span
              className={`text-sm font-semibold ${
                compliancePct === 100
                  ? 'text-[#16A34A]'
                  : compliancePct >= 80
                  ? 'text-[#D97706]'
                  : 'text-[#DC2626]'
              }`}
            >
              {compliancePct}% compliance
            </span>
          </div>

          {gaps.length > 0 && (
            <div className="space-y-1 mt-2">
              {gaps.map((gap, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs text-gray-500"
                >
                  <span className="text-[#D97706]">△</span>
                  Gap at {formatTime(gap.gap_start)} — {gap.duration_minutes} min
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Invoices summary ── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="section-label mb-3">Invoices</p>

          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">
              {invoicesCount} invoice{invoicesCount !== 1 ? 's' : ''}
            </span>
            {invoicesCount > 0 && (
              <span className="text-lg font-bold text-[#1A1A1A]">
                {formatCurrency(invoicesTotalValue)}
              </span>
            )}
          </div>

          {invoices.length > 0 && (
            <div className="space-y-0.5 mt-1">
              {invoices.map(inv => (
                <p key={inv.id} className="text-sm text-gray-600">
                  · {inv.supplier_name}
                </p>
              ))}
            </div>
          )}

          {invoicesCount === 0 && (
            <p className="text-sm text-gray-400">No invoices scanned today</p>
          )}
        </div>

        {/* ── Till Balance ── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="section-label mb-3">Till Balance</p>

          <div className="space-y-3">

            {/* Float reference */}
            {tillFloat !== null && (
              <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-gray-50">
                <span className="text-sm text-gray-500">Expected float</span>
                <span className="text-sm font-semibold text-[#1A1A1A]">{formatCurrency(tillFloat)}</span>
              </div>
            )}

            {/* Cash Counted */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
                Cash Counted
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cashTotal}
                  onChange={e => setCashTotal(e.target.value)}
                  placeholder={tillFloat !== null ? tillFloat.toFixed(2) : '0.00'}
                  className="w-full pl-7 pr-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                />
              </div>
            </div>

            {/* Cash breakdown — shown once cash + float are available */}
            {cashTotal !== '' && tillFloat !== null && (
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                  <span className="text-sm text-gray-600">
                    Cash Sales <span className="text-xs text-gray-400">({formatCurrency(cashNum)} − {formatCurrency(tillFloat)} float)</span>
                  </span>
                  <span className="text-sm font-semibold text-[#1A1A1A]">{formatCurrency(cashSales)}</span>
                </div>
                <div className={`flex items-center justify-between px-3 py-2 ${
                  !tillIsDiscrepancy ? 'bg-green-50' : cashVariance! > 0 ? 'bg-amber-50' : 'bg-red-50'
                }`}>
                  <span className={`text-sm font-semibold ${
                    !tillIsDiscrepancy ? 'text-[#16A34A]' : cashVariance! > 0 ? 'text-[#D97706]' : 'text-[#DC2626]'
                  }`}>
                    {!tillIsDiscrepancy
                      ? '✓ Balanced'
                      : cashVariance! > 0
                      ? `OVER  +${formatCurrency(cashVariance!)}`
                      : `SHORT  −${formatCurrency(Math.abs(cashVariance!))}`}
                  </span>
                  <span className="text-xs text-gray-400">variance</span>
                </div>
              </div>
            )}

            {/* EFTPOS */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
                EFTPOS Total
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={eftposTotal}
                  onChange={e => setEftposTotal(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                />
              </div>
            </div>

            {/* Total Takings */}
            {tillEntered && (
              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <div>
                  <span className="text-sm font-semibold text-gray-700">Total Takings</span>
                  {cashTotal !== '' && eftposTotal !== '' && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatCurrency(cashSales)} cash + {formatCurrency(eftposNum)} EFTPOS
                    </p>
                  )}
                </div>
                <span className="text-xl font-bold text-[#1A1A1A]">{formatCurrency(tillTotal)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Till Reconciliation ── */}
        <div className={`rounded-2xl p-4 shadow-sm border-2 transition-colors ${
          tillBalanced === null
            ? 'bg-white border-gray-200'
            : tillBalanced
            ? 'bg-white border-[#16A34A]'
            : 'bg-white border-[#DC2626]'
        }`}>
          {/* Header */}
          <div className="flex items-center gap-2 mb-4">
            <p className="section-label">Till Reconciliation</p>
            <span className="text-[#DC2626] text-xs font-semibold">Required</span>
          </div>

          <p className="text-sm font-semibold text-[#1A1A1A] mb-3">Did the till balance?</p>

          {/* Yes / No toggle buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setTillBalanced(true)}
              className={`py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-95 ${
                tillBalanced === true
                  ? 'bg-[#16A34A] text-white shadow-md'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              <span className="text-xl">✓</span>
              <span>Yes</span>
            </button>
            <button
              onClick={() => {
                setTillBalanced(false)
                // Pre-fill discrepancy amount from calculated variance if available
                if (cashVariance !== null && tillDiscrepancyAmount === '') {
                  setTillDiscrepancyAmount(cashVariance.toFixed(2))
                }
              }}
              className={`py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-95 ${
                tillBalanced === false
                  ? 'bg-[#DC2626] text-white shadow-md'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              <span className="text-xl">✗</span>
              <span>No</span>
            </button>
          </div>

          {/* Discrepancy fields — animate in when No is selected */}
          <div
            className="overflow-hidden transition-all duration-300 ease-in-out"
            style={{ maxHeight: tillBalanced === false ? '400px' : '0px', opacity: tillBalanced === false ? 1 : 0 }}
          >
            <div className="pt-4 space-y-3">
              {/* Discrepancy amount */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Discrepancy Amount <span className="text-[#DC2626]">*</span>
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  Positive = till is over, negative = till is short
                </p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={tillDiscrepancyAmount}
                    onChange={e => setTillDiscrepancyAmount(e.target.value)}
                    placeholder="e.g. -5.00 or +10.00"
                    className="w-full pl-7 pr-4 py-3 rounded-xl border border-red-300 bg-red-50 text-base focus:outline-none focus:ring-2 focus:ring-[#DC2626] text-[#1A1A1A]"
                  />
                </div>
              </div>

              {/* Explanation */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Explanation <span className="text-[#DC2626]">*</span>
                </label>
                <textarea
                  value={tillExplanation}
                  onChange={e => setTillExplanation(e.target.value)}
                  placeholder="What happened? (e.g. gave $10 refund in cash, mis-keyed sale, counted twice…)"
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-red-300 bg-red-50 text-base focus:outline-none focus:ring-2 focus:ring-[#DC2626] resize-none text-[#1A1A1A] placeholder-red-300"
                />
              </div>

              <div className="flex items-start gap-2 px-3 py-2 bg-red-50 rounded-xl border border-red-200">
                <span className="text-[#DC2626] mt-0.5">⚠</span>
                <p className="text-xs text-[#DC2626] font-medium">
                  This discrepancy will be logged and flagged in the owner&apos;s report.
                </p>
              </div>
            </div>
          </div>

          {/* Balanced confirmation */}
          {tillBalanced === true && (
            <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-green-50 rounded-xl">
              <span className="text-[#16A34A]">✓</span>
              <p className="text-sm font-medium text-[#16A34A]">Till balanced — recorded</p>
            </div>
          )}
        </div>

        {/* ── Notes ── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="section-label mb-3">Notes</p>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anything to flag for the owner…"
            rows={3}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C] resize-none"
          />
        </div>

        {/* ── Submit button ── */}
        <button
          onClick={handleSubmitClick}
          disabled={submitting}
          className="w-full py-4 rounded-full font-bold text-white text-base disabled:opacity-40 shadow-md"
          style={{ backgroundColor: '#B8960C' }}
        >
          {submitting ? 'Submitting…' : 'Submit & Close Day'}
        </button>

      </div>
    </div>
  )
}
