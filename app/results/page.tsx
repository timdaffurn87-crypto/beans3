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
    if (!loading && profile && (profile.role === 'barista' || profile.role === 'kitchen')) router.push('/')
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
        <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#296861', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  const last7Days = getLast7CafeDays()
  const today = getCurrentCafeDay()
  const isOwner = profile.role === 'owner'

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>

      {/* Header */}
      <div className="px-5 pt-12 pb-4">
        <p className="section-label mb-2" style={{ color: '#296861' }}>Metrics & Insights</p>
        <h1 className="text-4xl font-bold leading-tight" style={{ color: '#2D2D2D' }}>
          7-Day
          <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic', display: 'block' }}>
            Performance
          </span>
          Report
        </h1>
        <div className="flex items-center gap-2 mt-3">
          <span className="material-symbols-outlined text-gray-400" style={{ fontSize: '16px' }}>calendar_today</span>
          <p className="text-sm text-gray-400">Week ending {formatDisplayDate(last7Days[0])}</p>
        </div>
      </div>

      <div className="px-5 space-y-6">

        {/* ── KPI Target cards ── */}
        <div className="space-y-3">

          {/* Waste Goal */}
          <div className="bg-white rounded-2xl p-4 card-interactive">
            <div className="flex items-start justify-between mb-2">
              <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '22px' }}>delete_outline</span>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FFF8E7', color: '#C47F17' }}>Priority</span>
            </div>
            <p className="font-semibold text-sm text-gray-600">Waste Goal</p>
            <p className="text-xs text-gray-400">Maintain lean operations</p>
            <p className="text-3xl font-bold mt-2" style={{ color: '#2D2D2D' }}>
              &lt; {formatCurrency(targets.waste)}
            </p>
            <p className="section-label mt-1">Target per week</p>
          </div>

          {/* Task Completion */}
          <div className="bg-white rounded-2xl p-4 card-interactive">
            <div className="flex items-start justify-between mb-2">
              <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '22px' }}>checklist</span>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Standard</span>
            </div>
            <p className="font-semibold text-sm text-gray-600">Task Completion</p>
            <p className="text-xs text-gray-400">Daily operational checklists</p>
            <p className="text-3xl font-bold mt-2" style={{ color: '#2D2D2D' }}>≥ {targets.tasks}%</p>
            <p className="section-label mt-1">Team minimum requirement</p>
          </div>

          {/* Calibration — dark teal card */}
          <div className="rounded-2xl p-4 card-interactive" style={{ background: 'linear-gradient(135deg, #296861 0%, #1a4a45 100%)' }}>
            <div className="flex items-start justify-between mb-2">
              <span className="material-symbols-outlined text-white/70" style={{ fontSize: '22px' }}>tune</span>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: 'white' }}>Critical</span>
            </div>
            <p className="font-semibold text-sm text-white">Calibration</p>
            <p className="text-xs text-white/60">Equipment precision check</p>
            <p className="text-3xl font-bold mt-2 text-white">{targets.calibration}%</p>
            <p className="section-label mt-1 text-white/50">Zero tolerance deviation</p>
          </div>

          {/* Inline target edit form (owner only, when editing) */}
          {isOwner && editingTargets && (
            <div className="bg-white rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <p className="font-semibold text-sm" style={{ color: '#2D2D2D' }}>Edit Targets</p>
                <button onClick={() => setEditingTargets(false)} className="text-sm text-gray-400">Cancel</button>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Daily Waste Limit ($)</label>
                <input
                  type="number" step="1" min="0" value={editWaste}
                  onChange={e => setEditWaste(e.target.value)}
                  className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Task Completion Target (%)</label>
                <input
                  type="number" step="1" min="0" max="100" value={editTasks}
                  onChange={e => setEditTasks(e.target.value)}
                  className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Calibration Target (%)</label>
                <input
                  type="number" step="1" min="0" max="100" value={editCal}
                  onChange={e => setEditCal(e.target.value)}
                  className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
                />
              </div>
              <button
                onClick={handleSaveTargets}
                disabled={savingTargets}
                className="w-full py-3 rounded-full text-white font-semibold disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #296861 0%, #73b0a8 100%)' }}
              >
                {savingTargets ? 'Saving…' : 'Save Targets'}
              </button>
            </div>
          )}
        </div>

        {/* ── Daily Breakdown ── */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-2xl font-bold" style={{ color: '#2D2D2D' }}>
              Daily{' '}
              <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic' }}>Breakdown</span>
            </h2>
            <p className="text-xs text-gray-400">Performance over last 7 cycles</p>
          </div>

          <div className="space-y-2">
            {last7Days.map((day, index) => {
              const report = reports[day]
              const isToday = day === today
              const dateLabel = formatDisplayDate(day)
              const dayHeading = isToday ? `Today — ${dateLabel}` : dateLabel

              // Day-of-week label for featured card
              const dayOfWeek = new Date(day + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'long' }).toUpperCase()

              const taskPct = report && report.tasks_total > 0
                ? Math.round((report.tasks_completed / report.tasks_total) * 100)
                : 0

              return (
                <div key={day}>
                  {report ? (
                    index === 0 ? (
                      // ── Featured card for most recent day with report ──
                      <button
                        onClick={() => router.push(`/results/${day}`)}
                        className="w-full bg-white rounded-2xl p-4 card-interactive text-left"
                        style={{ borderLeft: '3px solid #296861' }}
                      >
                        <p className="section-label mb-0.5" style={{ color: '#296861' }}>{dayOfWeek}</p>
                        <div className="flex items-center justify-between mb-3">
                          <p className="font-bold text-base" style={{ color: '#2D2D2D' }}>{dateLabel}</p>
                          <span className="text-gray-300 text-base">›</span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-[#FAF8F3] rounded-xl p-3">
                            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Tasks</p>
                            <p className={`text-lg font-bold ${taskColour(taskPct, targets.tasks)}`}>
                              {report.tasks_total > 0 ? `${taskPct}%` : '—'}
                            </p>
                            <p className="text-xs text-gray-400">{report.tasks_completed}/{report.tasks_total} done</p>
                          </div>
                          <div className="bg-[#FAF8F3] rounded-xl p-3">
                            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Waste</p>
                            <p className={`text-lg font-bold ${wasteColour(report.waste_total_value, targets.waste)}`}>
                              {formatCurrency(report.waste_total_value)}
                            </p>
                            <p className="text-xs text-gray-400">total value</p>
                          </div>
                          <div className="bg-[#FAF8F3] rounded-xl p-3">
                            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Calibration</p>
                            <p className={`text-lg font-bold ${calColour(report.calibration_compliance_pct)}`}>
                              {report.calibration_compliance_pct}%
                            </p>
                            <p className="text-xs text-gray-400">{report.calibration_count} logged</p>
                          </div>
                          <div className="bg-[#FAF8F3] rounded-xl p-3">
                            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Invoices</p>
                            <p className="text-lg font-bold" style={{ color: '#2D2D2D' }}>{report.invoices_count}</p>
                            <p className="text-xs text-gray-400">{report.invoices_count === 1 ? 'invoice' : 'invoices'}</p>
                          </div>
                        </div>
                      </button>
                    ) : (
                      // ── Compact row for older days ──
                      <button
                        onClick={() => router.push(`/results/${day}`)}
                        className="w-full bg-white rounded-2xl p-3 card-interactive text-left"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold" style={{ color: '#2D2D2D' }}>{dateLabel}</p>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-gray-400">
                              Tasks <strong className={taskColour(taskPct, targets.tasks)}>{report.tasks_total > 0 ? `${taskPct}%` : '—'}</strong>
                            </span>
                            <span className="text-gray-400">
                              Waste <strong className={wasteColour(report.waste_total_value, targets.waste)}>{formatCurrency(report.waste_total_value)}</strong>
                            </span>
                            <span className="text-gray-400">
                              Calib <strong className={calColour(report.calibration_compliance_pct)}>{report.calibration_compliance_pct}%</strong>
                            </span>
                            <span className="text-gray-300">›</span>
                          </div>
                        </div>
                      </button>
                    )
                  ) : (
                    // No report for this day
                    <div className="bg-white rounded-2xl p-3 opacity-40">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold" style={{ color: '#2D2D2D' }}>{dayHeading}</p>
                        <p className="text-xs text-gray-400">No report submitted</p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Manager's Summary card ── */}
        <div className="rounded-2xl overflow-hidden card-interactive" style={{ background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)' }}>
          <div className="p-5">
            <h2 className="text-2xl font-bold text-white leading-tight">
              Manager&apos;s
              <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic', display: 'block' }}>
                Summary
              </span>
            </h2>
            <p className="text-sm text-white/60 mt-2 leading-relaxed">
              Review performance against targets. Tap any day above to drill into the full EOD report.
            </p>
            {isOwner && !editingTargets && (
              <button
                onClick={() => setEditingTargets(true)}
                className="mt-4 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, #296861 0%, #73b0a8 100%)' }}
              >
                Edit Targets
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
