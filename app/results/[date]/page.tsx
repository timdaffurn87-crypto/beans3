'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { formatDisplayDate, formatCurrency, formatTime } from '@/lib/utils'
import type { EODReport } from '@/lib/types'

/** EOD Report drill-down detail — Manager/Owner only */
export default function ResultsDetailPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const date = params.date as string

  const [report, setReport] = useState<EODReport | null>(null)
  const [submitterName, setSubmitterName] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Auth guard — baristas cannot access this page
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
    if (!loading && profile && (profile.role === 'barista' || profile.role === 'kitchen')) router.push('/')
  }, [profile, loading, router])

  /** Fetch the EOD report for the given date and the submitter's name */
  async function fetchReport() {
    const supabase = createClient()

    const { data, error } = await supabase
      .from('eod_reports')
      .select('*')
      .eq('cafe_day', date)
      .single()

    if (error || !data) {
      setNotFound(true)
      setLoadingData(false)
      return
    }

    const reportData = data as EODReport
    setReport(reportData)

    // Fetch the submitter's name separately
    const { data: submitter } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', reportData.submitted_by)
      .single()

    setSubmitterName(submitter?.full_name ?? null)
    setLoadingData(false)
  }

  useEffect(() => {
    if (profile && date) fetchReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, date])

  if (loading || loadingData || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Format the date for display
  const displayDate = date ? formatDisplayDate(date) : date

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <button
          onClick={() => router.push('/results')}
          className="text-[#B8960C] text-sm mb-3 flex items-center gap-1"
        >
          ← 7-Day Results
        </button>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">{displayDate}</h1>
        {report && submitterName && (
          <p className="text-sm text-gray-400 mt-1">
            Submitted by {submitterName} at {formatTime(report.created_at)}
          </p>
        )}
      </div>

      <div className="px-5 space-y-4">

        {/* No report found */}
        {notFound && (
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <p className="font-semibold text-[#1A1A1A]">No report submitted</p>
            <p className="text-sm text-gray-400 mt-1">
              No EOD report was submitted for this day.
            </p>
          </div>
        )}

        {report && (
          <>
            {/* ── Tasks ── */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="section-label mb-3">Tasks</p>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">
                  {report.tasks_completed} of {report.tasks_total} completed
                </span>
                {report.tasks_total > 0 && (
                  <span
                    className={`text-sm font-bold ${
                      Math.round((report.tasks_completed / report.tasks_total) * 100) >= 90
                        ? 'text-[#16A34A]'
                        : Math.round((report.tasks_completed / report.tasks_total) * 100) >= 70
                        ? 'text-[#D97706]'
                        : 'text-[#DC2626]'
                    }`}
                  >
                    {Math.round((report.tasks_completed / report.tasks_total) * 100)}%
                  </span>
                )}
              </div>
              {report.tasks_total > 0 && (
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(report.tasks_completed / report.tasks_total) * 100}%`,
                      backgroundColor:
                        report.tasks_completed === report.tasks_total ? '#16A34A' : '#D97706',
                    }}
                  />
                </div>
              )}
            </div>

            {/* ── Waste ── */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="section-label mb-3">Waste</p>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-600">Total waste value</span>
                <span className="text-xl font-bold text-[#DC2626]">
                  {formatCurrency(report.waste_total_value)}
                </span>
              </div>
              {report.waste_top_items && report.waste_top_items.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Top Items</p>
                  {report.waste_top_items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600 truncate flex-1 mr-2">
                        {item.item_name} ×{item.quantity}
                      </span>
                      <span className="text-sm font-medium text-[#1A1A1A] shrink-0">
                        {formatCurrency(item.total_cost)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {(!report.waste_top_items || report.waste_top_items.length === 0) && (
                <p className="text-sm text-gray-400">No waste logged</p>
              )}
            </div>

            {/* ── Calibration ── */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="section-label mb-3">Calibration</p>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">
                  {report.calibration_count} calibration{report.calibration_count !== 1 ? 's' : ''} logged
                </span>
                <span
                  className={`text-sm font-bold ${
                    report.calibration_compliance_pct === 100
                      ? 'text-[#16A34A]'
                      : report.calibration_compliance_pct >= 80
                      ? 'text-[#D97706]'
                      : 'text-[#DC2626]'
                  }`}
                >
                  {report.calibration_compliance_pct}% compliance
                </span>
              </div>
              {report.calibration_gaps && report.calibration_gaps.length > 0 && (
                <div className="space-y-1 mt-2">
                  {report.calibration_gaps.map((gap, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="text-[#D97706]">△</span>
                      Gap at {formatTime(gap.gap_start)} — {gap.duration_minutes} min
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Invoices ── */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="section-label mb-3">Invoices</p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  {report.invoices_count} invoice{report.invoices_count !== 1 ? 's' : ''}
                </span>
                {report.invoices_count > 0 && (
                  <span className="text-lg font-bold text-[#1A1A1A]">
                    {formatCurrency(report.invoices_total_value)}
                  </span>
                )}
              </div>
              {report.invoices_count === 0 && (
                <p className="text-sm text-gray-400 mt-1">No invoices scanned</p>
              )}
            </div>

            {/* ── Notes ── */}
            {report.notes && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <p className="section-label mb-3">Notes</p>
                <p className="text-sm text-gray-700 italic leading-relaxed">{report.notes}</p>
              </div>
            )}

            {/* ── Submitted by ── */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Submitted by</span>
                <span className="text-sm font-semibold text-[#1A1A1A]">
                  {submitterName ?? 'Unknown'} at {formatTime(report.created_at)}
                </span>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
