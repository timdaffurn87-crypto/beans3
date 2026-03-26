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

  // Auth guard
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
  }, [profile, loading, router])

  /** Load all café-day data needed for the EOD summary */
  async function fetchDayData() {
    const supabase = createClient()

    const [tasksRes, wasteRes, calRes, invoicesRes, eodRes] = await Promise.all([
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
    ])

    setTasks((tasksRes.data as DailyTask[]) ?? [])
    setWasteLogs((wasteRes.data as WasteLog[]) ?? [])
    setCalibrationRows((calRes.data as CalibrationRow[]) ?? [])
    setInvoices((invoicesRes.data as Invoice[]) ?? [])
    // .single() returns an error if no row — treat that as "not submitted"
    setAlreadySubmitted(!!eodRes.data)
    setLoadingData(false)
  }

  useEffect(() => {
    if (profile) fetchDayData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  /** Begin submission — show warning modal if tasks are incomplete, else submit directly */
  function handleSubmitClick() {
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
      // 1. Save the EOD report
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
        notes: notes.trim() || null,
      }

      const { error: insertError } = await supabase
        .from('eod_reports')
        .insert(reportPayload)

      if (insertError) {
        showToast(insertError.message, 'error')
        return
      }

      // 2. Mark all today's invoices as submitted
      await supabase
        .from('invoices')
        .update({ status: 'submitted' })
        .eq('cafe_day', cafeDay)

      // 3. Log activity
      await logActivity(profile.id, 'eod_submitted', `EOD report submitted for ${cafeDay}`)

      // 4. Send EOD email
      await fetch('/api/eod-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportPayload),
      })

      // 5. Show success screen
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
          </div>
        </div>
      </div>
    )
  }

  // ── Submitted successfully this session ──────────────────────────────────
  if (submitted) {
    return (
      <div
        className="min-h-screen flex items-center justify-center pb-24"
        style={{ backgroundColor: '#FAF8F3' }}
      >
        <div className="px-5 w-full max-w-sm">
          <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
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
            <h2 className="text-2xl font-bold text-[#1A1A1A] mb-2">Day Closed</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              Great shift. Report submitted and emailed to the owner.
            </p>
            <button
              onClick={handleSignOut}
              className="mt-6 w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold"
            >
              Back to Login
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
