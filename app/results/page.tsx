'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { getCurrentCafeDay, formatDate } from '@/lib/cafe-day'
import { formatDisplayDate, formatCurrency } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import type { EODReport } from '@/lib/types'

// Default targets if none are configured in settings
const DEFAULT_WASTE_TARGET = 50
const DEFAULT_TASKS_TARGET = 90
const DEFAULT_CAL_TARGET = 100

interface Targets {
  waste: number
  tasks: number
  calibration: number
}

/**
 * Generates an array of the last 7 café day date strings (YYYY-MM-DD).
 * The first element is today, the last is 6 days ago.
 */
function getLast7CafeDays(): string[] {
  const days: string[] = []
  const today = getCurrentCafeDay()
  for (let i = 0; i < 7; i++) {
    const d = new Date(today + 'T12:00:00') // noon to avoid DST issues
    d.setDate(d.getDate() - i)
    days.push(formatDate(d))
  }
  return days
}

/** Returns a colour class string for task % vs target */
function taskColour(pct: number, target: number): string {
  if (pct >= target) return 'text-[#16A34A]'
  if (pct >= 70) return 'text-[#D97706]'
  return 'text-[#DC2626]'
}

/** Returns a colour class string for waste $ vs target */
function wasteColour(value: number, target: number): string {
  if (value <= target) return 'text-[#16A34A]'
  if (value <= target * 1.5) return 'text-[#D97706]'
  return 'text-[#DC2626]'
}

/** Returns a colour class string for calibration % */
function calColour(pct: number): string {
  if (pct === 100) return 'text-[#16A34A]'
  if (pct >= 80) return 'text-[#D97706]'
  return 'text-[#DC2626]'
}

/** 7-Day Performance Results page — Manager/Owner only */
export default function ResultsPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()

  const [reports, setReports] = useState<Record<string, EODReport>>({})
  const [targets, setTargets] = useState<Targets>({
    waste: DEFAULT_WASTE_TARGET,
    tasks: DEFAULT_TASKS_TARGET,
    calibration: DEFAULT_CAL_TARGET,
  })
  const [loadingData, setLoadingData] = useState(true)

  // Edit-targets state (owner only)
  const [editingTargets, setEditingTargets] = useState(false)
  const [editWaste, setEditWaste] = useState('')
  const [editTasks, setEditTasks] = useState('')
  const [editCal, setEditCal] = useState('')
  const [savingTargets, setSavingTargets] = useState(false)

  // Auth guard — baristas cannot access this page
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
    if (!loading && profile && profile.role === 'barista') router.push('/')
  }, [profile, loading, router])

  /** Fetch EOD reports and targets for the last 7 café days */
  async function fetchData() {
    const supabase = createClient()
    const last7Days = getLast7CafeDays()

    const [reportsRes, settingsRes] = await Promise.all([
      supabase
        .from('eod_reports')
        .select('*')
        .in('cafe_day', last7Days)
        .order('cafe_day', { ascending: false }),
      supabase
        .from('settings')
        .select('key, value')
        .in('key', ['target_daily_waste', 'target_task_completion', 'target_calibration_compliance']),
    ])

    // Map reports by cafe_day for quick lookup
    const reportMap: Record<string, EODReport> = {}
    for (const r of (reportsRes.data ?? []) as EODReport[]) {
      reportMap[r.cafe_day] = r
    }
    setReports(reportMap)

    // Parse targets from settings
    const settingsMap: Record<string, string> = {}
    for (const s of settingsRes.data ?? []) {
      settingsMap[s.key] = s.value
    }
    const parsedTargets: Targets = {
      waste: parseFloat(settingsMap['target_daily_waste'] ?? '') || DEFAULT_WASTE_TARGET,
      tasks: parseFloat(settingsMap['target_task_completion'] ?? '') || DEFAULT_TASKS_TARGET,
      calibration: parseFloat(settingsMap['target_calibration_compliance'] ?? '') || DEFAULT_CAL_TARGET,
    }
    setTargets(parsedTargets)
    setEditWaste(parsedTargets.waste.toString())
    setEditTasks(parsedTargets.tasks.toString())
    setEditCal(parsedTargets.calibration.toString())

    setLoadingData(false)
  }

  useEffect(() => {
    if (profile) fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  /** Save updated targets to the settings table */
  async function handleSaveTargets() {
    const waste = parseFloat(editWaste)
    const tasks = parseFloat(editTasks)
    const cal = parseFloat(editCal)

    if (isNaN(waste) || waste < 0) { showToast('Enter a valid waste limit', 'error'); return }
    if (isNaN(tasks) || tasks < 0 || tasks > 100) { showToast('Tasks target must be 0–100', 'error'); return }
    if (isNaN(cal) || cal < 0 || cal > 100) { showToast('Calibration target must be 0–100', 'error'); return }

    setSavingTargets(true)
    const supabase = createClient()

    const upserts = [
      { key: 'target_daily_waste', value: waste.toString(), updated_at: new Date().toISOString() },
      { key: 'target_task_completion', value: tasks.toString(), updated_at: new Date().toISOString() },
      { key: 'target_calibration_compliance', value: cal.toString(), updated_at: new Date().toISOString() },
    ]

    const { error } = await supabase
      .from('settings')
      .upsert(upserts, { onConflict: 'key' })

    setSavingTargets(false)

    if (error) {
      showToast(error.message, 'error')
      return
    }

    setTargets({ waste, tasks, calibration: cal })
    setEditingTargets(false)
    showToast('Targets saved', 'success')
  }

  if (loading || loadingData || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const last7Days = getLast7CafeDays()
  const today = getCurrentCafeDay()
  const isOwner = profile.role === 'owner'

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <button onClick={() => router.back()} className="text-[#B8960C] text-sm mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">7-Day Performance</h1>
        <p className="text-sm text-gray-400 mt-1">Rolling 7-day results</p>
      </div>

      <div className="px-5 space-y-4">

        {/* ── Targets section ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">Performance Targets</p>
            {isOwner && !editingTargets && (
              <button
                onClick={() => setEditingTargets(true)}
                className="text-sm font-semibold text-[#B8960C]"
              >
                Edit Targets
              </button>
            )}
            {isOwner && editingTargets && (
              <button
                onClick={() => setEditingTargets(false)}
                className="text-sm text-gray-400"
              >
                Cancel
              </button>
            )}
          </div>

          {!editingTargets ? (
            // Read-only targets display
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">Waste</span>
                  <span className="text-sm font-semibold text-[#1A1A1A]">&lt; {formatCurrency(targets.waste)}</span>
                </div>
                <span className="text-gray-200">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">Tasks</span>
                  <span className="text-sm font-semibold text-[#1A1A1A]">≥ {targets.tasks}%</span>
                </div>
                <span className="text-gray-200">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">Calibration</span>
                  <span className="text-sm font-semibold text-[#1A1A1A]">{targets.calibration}%</span>
                </div>
              </div>
            </div>
          ) : (
            // Inline edit form (owner only)
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Daily Waste Limit ($)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={editWaste}
                  onChange={e => setEditWaste(e.target.value)}
                  className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Task Completion Target (%)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={editTasks}
                  onChange={e => setEditTasks(e.target.value)}
                  className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Calibration Compliance Target (%)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={editCal}
                  onChange={e => setEditCal(e.target.value)}
                  className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
                />
              </div>
              <button
                onClick={handleSaveTargets}
                disabled={savingTargets}
                className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
              >
                {savingTargets ? 'Saving…' : 'Save Targets'}
              </button>
            </div>
          )}
        </div>

        {/* ── Day-by-day cards ── */}
        <div>
          <p className="section-label mb-3">Daily Breakdown</p>
          <div className="space-y-3">
            {last7Days.map((day, index) => {
              const report = reports[day]
              const isToday = day === today

              // Day label: "Today — Thursday, Mar 26" or just the date
              const dateLabel = formatDisplayDate(day)
              const dayHeading = isToday ? `Today — ${dateLabel}` : dateLabel

              return (
                <div key={day}>
                  {report ? (
                    // Tappable card with full data
                    <button
                      onClick={() => router.push(`/results/${day}`)}
                      className="w-full bg-white rounded-2xl p-4 shadow-sm text-left active:scale-[0.99] transition-transform"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-semibold text-[#1A1A1A] text-sm">{dayHeading}</p>
                        <span className="text-gray-300 text-base">›</span>
                      </div>

                      {/* 2×2 metrics grid */}
                      <div className="grid grid-cols-2 gap-2">
                        {/* Tasks */}
                        <div className="bg-[#FAF8F3] rounded-xl p-3">
                          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Tasks</p>
                          {report.tasks_total > 0 ? (
                            <p className={`text-lg font-bold ${taskColour(
                              Math.round((report.tasks_completed / report.tasks_total) * 100),
                              targets.tasks
                            )}`}>
                              {Math.round((report.tasks_completed / report.tasks_total) * 100)}%
                            </p>
                          ) : (
                            <p className="text-lg font-bold text-gray-400">—</p>
                          )}
                          <p className="text-xs text-gray-400">
                            {report.tasks_completed}/{report.tasks_total} done
                          </p>
                        </div>

                        {/* Waste */}
                        <div className="bg-[#FAF8F3] rounded-xl p-3">
                          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Waste</p>
                          <p className={`text-lg font-bold ${wasteColour(report.waste_total_value, targets.waste)}`}>
                            {formatCurrency(report.waste_total_value)}
                          </p>
                          <p className="text-xs text-gray-400">total value</p>
                        </div>

                        {/* Calibration */}
                        <div className="bg-[#FAF8F3] rounded-xl p-3">
                          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Calibration</p>
                          <p className={`text-lg font-bold ${calColour(report.calibration_compliance_pct)}`}>
                            {report.calibration_compliance_pct}%
                          </p>
                          <p className="text-xs text-gray-400">{report.calibration_count} logged</p>
                        </div>

                        {/* Invoices */}
                        <div className="bg-[#FAF8F3] rounded-xl p-3">
                          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Invoices</p>
                          <p className="text-lg font-bold text-[#1A1A1A]">
                            {report.invoices_count}
                          </p>
                          <p className="text-xs text-gray-400">
                            {report.invoices_count === 1 ? 'invoice' : 'invoices'}
                          </p>
                        </div>
                      </div>
                    </button>
                  ) : (
                    // No report for this day
                    <div className="bg-white rounded-2xl p-4 shadow-sm opacity-50">
                      <p className="font-semibold text-[#1A1A1A] text-sm mb-1">{dayHeading}</p>
                      <p className="text-sm text-gray-400">No report submitted</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}
