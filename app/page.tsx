'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useRole } from '@/hooks/useRole'
import { useCalibration } from '@/hooks/useCalibration'
import { getGreeting, getCurrentCafeDay, getNowAEST } from '@/lib/cafe-day'
import { formatDisplayDate, formatCurrency, formatTime } from '@/lib/utils'
import { createClient } from '@/lib/supabase'
import type { Profile, DailyTask } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaffTaskCount {
  id: string
  full_name: string
  role: string
  count: number
}

interface DashboardData {
  tasksCompleted: number
  tasksTotal: number
  wasteTotal: number
  dayIsClosed: boolean
  invoicesTotal: number
  invoicesCount: number
  calibrationCount: number
  incompleteTasks: DailyTask[]
  recentTasks: DailyTask[]           // first 4 for staff checklist
  staffProfiles: Pick<Profile, 'id' | 'full_name' | 'role'>[]
  tasksByStaff: StaffTaskCount[]     // ranked by tasks completed today
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extracts initials from a full name — "Elena Rodriguez" → "ER" */
function initials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

/** Role label for display under a staff avatar */
function roleLabel(role: string): string {
  if (role === 'owner') return 'Owner'
  if (role === 'manager') return 'Manager'
  return 'Barista'
}

/**
 * Calculates shift progress as a 0–100% number based on where the current
 * time falls within the café day window (default 05:30–15:00).
 */
function shiftProgress(start = '05:30', end = '15:00'): number {
  const now = getNowAEST()
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin   = eh * 60 + em
  const nowMin   = now.getHours() * 60 + now.getMinutes()
  if (nowMin <= startMin) return 0
  if (nowMin >= endMin)   return 100
  return Math.round(((nowMin - startMin) / (endMin - startMin)) * 100)
}

/** Returns a colour token for a task completion % */
function taskEffColour(pct: number) {
  if (pct >= 90) return '#16A34A'
  if (pct >= 70) return '#D97706'
  return '#DC2626'
}

// ─── Shared header ────────────────────────────────────────────────────────────

function DashboardHeader({
  name,
  xeroConnected,
  onLogOut,
  showMenu = false,
}: {
  name: string
  xeroConnected: boolean
  onLogOut: () => void
  showMenu?: boolean
}) {
  return (
    <div className="px-5 pt-12 pb-2 flex items-center justify-between">
      {/* Avatar + wordmark */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, #296861 0%, #73b0a8 100%)' }}
        >
          {initials(name)}
        </div>
        <span className="font-semibold text-sm" style={{ color: '#296861' }}>Cocoa</span>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3">
        {xeroConnected && (
          <span
            className="block w-2 h-2 rounded-full animate-pulse-matcha shrink-0"
            style={{ backgroundColor: 'var(--accent-matcha)' }}
            title="Xero connected"
          />
        )}
        <button className="text-gray-400">
          <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>notifications</span>
        </button>
        {showMenu ? (
          <button className="text-gray-400">
            <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>menu</span>
          </button>
        ) : (
          <button onClick={onLogOut} className="text-gray-400">
            <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>logout</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Staff avatar row ────────────────────────────────────────────────────────

function StaffAvatarRow({ staff, limit = 4 }: { staff: Pick<Profile, 'id' | 'full_name' | 'role'>[]; limit?: number }) {
  const shown = staff.slice(0, limit)
  const rest  = staff.length - limit
  return (
    <div className="flex items-center gap-3">
      {shown.map(s => (
        <div key={s.id} className="flex flex-col items-center gap-1">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #296861 0%, #73b0a8 100%)' }}
          >
            {initials(s.full_name)}
          </div>
          <p className="text-[10px] text-gray-400 max-w-[48px] text-center leading-tight truncate">{s.full_name.split(' ')[0]}</p>
        </div>
      ))}
      {rest > 0 && (
        <div className="flex flex-col items-center gap-1">
          <div className="w-10 h-10 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-xs font-semibold text-gray-400">
            +{rest}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Calibration inline card (for manager/staff dashboards) ──────────────────

function CalibrationCard() {
  const { lastCalibration, isOverdue, loading } = useCalibration()
  if (loading) return null

  if (isOverdue) {
    return (
      <Link href="/calibration">
        <div className="rounded-2xl p-5 cursor-pointer" style={{ background: 'linear-gradient(135deg, #7B1E1E 0%, #B22222 100%)' }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white' }}>
              Action Required
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white leading-tight" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic' }}>
            Espresso Calibration Overdue
          </h2>
          <p className="text-sm text-white/70 mt-1">
            {lastCalibration ? `Last calibrated at ${formatTime(lastCalibration)}` : 'Grind settings require immediate check.'}
          </p>
          <div className="mt-4 bg-white rounded-xl py-2.5 px-4 text-center">
            <span className="font-semibold text-sm" style={{ color: '#B22222' }}>Calibrate Now →</span>
          </div>
        </div>
      </Link>
    )
  }

  return (
    <div className="rounded-2xl px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#296861' }}>
      <div>
        <p className="text-xs font-semibold text-white/70 uppercase tracking-wider">Calibration</p>
        <p className="text-sm font-semibold text-white">Equipment Verified ✓</p>
      </div>
      {lastCalibration && (
        <p className="text-xs text-white/60">Last {formatTime(lastCalibration)}</p>
      )}
    </div>
  )
}

// ─── OWNER DASHBOARD ─────────────────────────────────────────────────────────

function OwnerDashboard({
  data,
  xeroConnected,
  name,
  cafeDay,
  onLogOut,
}: {
  data: DashboardData
  xeroConnected: boolean
  name: string
  cafeDay: string
  onLogOut: () => void
}) {
  const taskPct     = data.tasksTotal > 0 ? Math.round((data.tasksCompleted / data.tasksTotal) * 100) : 0
  const wasteTarget = 50 // default target — a real app would pull from settings

  // Show up to 6 tasks in the Operations Status panel; the rest are in /tasks
  const opsTasksShown = data.recentTasks.slice(0, 6)

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      <DashboardHeader name={name} xeroConnected={xeroConnected} onLogOut={onLogOut} showMenu />

      {/* ── Heading ── */}
      <div className="px-5 pt-4 pb-2">
        <p className="section-label mb-1" style={{ color: '#296861' }}>Overview</p>
        <h1 className="leading-none" style={{ color: '#2D2D2D' }}>
          <span className="text-5xl font-bold block">The Daily</span>
          <span className="text-5xl font-bold block" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic' }}>Ledger</span>
        </h1>
      </div>

      {/* Date + Generate Report */}
      <div className="px-5 pb-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-xl border border-gray-200">
          <span className="material-symbols-outlined text-gray-400" style={{ fontSize: '14px' }}>calendar_today</span>
          <span className="text-sm font-medium" style={{ color: '#2D2D2D' }}>{formatDisplayDate(cafeDay)}</span>
        </div>
        <Link
          href="/results"
          className="flex-1 py-2 rounded-xl text-center text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #296861 0%, #73b0a8 100%)' }}
        >
          Generate Report
        </Link>
      </div>

      <div className="px-5 space-y-4">

        {/* ── Invoice / Revenue card ── */}
        <div className="bg-white rounded-2xl p-5 card-interactive">
          <div className="flex items-start justify-between mb-3">
            <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '22px' }}>receipt_long</span>
            {data.invoicesCount > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ backgroundColor: '#E6F4F1', color: '#296861' }}>
                +{data.invoicesCount} invoices
              </span>
            )}
          </div>
          <p className="section-label mb-1">Today&apos;s Invoice Total</p>
          <p className="text-4xl font-bold leading-none" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', color: '#2D2D2D' }}>
            {formatCurrency(data.invoicesTotal)}
          </p>
        </div>

        {/* ── Waste card ── */}
        <div className="bg-white rounded-2xl p-5 card-interactive">
          <div className="flex items-start justify-between mb-3">
            <span className="material-symbols-outlined" style={{ color: '#B8960C', fontSize: '22px' }}>delete</span>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full" style={{
              backgroundColor: data.wasteTotal > wasteTarget ? '#FEE2E2' : '#F0FDF4',
              color: data.wasteTotal > wasteTarget ? '#DC2626' : '#16A34A',
            }}>
              {data.wasteTotal > wasteTarget ? 'Over target' : 'On track'}
            </span>
          </div>
          <p className="section-label mb-1">Waste Cost</p>
          <p className="text-4xl font-bold leading-none" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', color: '#2D2D2D' }}>
            {formatCurrency(data.wasteTotal)}
          </p>
          <div className="mt-3">
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (data.wasteTotal / wasteTarget) * 100)}%`,
                  backgroundColor: data.wasteTotal > wasteTarget ? '#DC2626' : '#16A34A',
                }}
              />
            </div>
            <p className="section-label mt-1">
              {Math.round((data.wasteTotal / wasteTarget) * 100)}% of daily threshold
            </p>
          </div>
        </div>

        {/* ── Task Efficiency — dark teal card ── */}
        <div className="rounded-2xl p-5 card-interactive" style={{ background: 'linear-gradient(135deg, #296861 0%, #1a4a45 100%)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-white/70" style={{ fontSize: '20px' }}>checklist</span>
            <p className="section-label text-white/60">Task Efficiency</p>
          </div>
          <p className="text-5xl font-bold text-white" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic' }}>
            {taskPct}%
          </p>
          <p className="section-label mt-1 text-white/50">
            {data.tasksCompleted}/{data.tasksTotal} operations complete
          </p>
        </div>

        {/* ── Operations Status ── */}
        <div className="bg-white rounded-2xl p-4 card-interactive">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic', color: '#2D2D2D' }}>
              Operations Status
            </h2>
            {data.tasksTotal > 0 && (
              <span className="text-xs font-semibold" style={{ color: taskPct === 100 ? '#16A34A' : '#D97706' }}>
                {data.tasksCompleted}/{data.tasksTotal} done
              </span>
            )}
          </div>

          <div className="space-y-2.5">
            {/* Pinned: Calibration */}
            <div className="flex items-center gap-3">
              {data.calibrationCount > 0 ? (
                <span className="material-symbols-outlined text-[#16A34A]" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              ) : (
                <span className="material-symbols-outlined text-[#DC2626]" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>error</span>
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${data.calibrationCount > 0 ? 'text-gray-500' : 'text-[#DC2626]'}`}>
                  Grinder Calibration
                </p>
                {data.calibrationCount > 0 && (
                  <p className="text-xs text-gray-400">{data.calibrationCount} logged today</p>
                )}
              </div>
            </div>

            {/* Divider */}
            {opsTasksShown.length > 0 && <div className="border-t border-gray-100" />}

            {/* Real task data */}
            {opsTasksShown.length === 0 ? (
              <p className="text-sm text-gray-400 py-1">No tasks generated yet today</p>
            ) : (
              opsTasksShown.map(task => {
                const done = !!task.completed_at
                return (
                  <div key={task.id} className="flex items-center gap-3">
                    {done ? (
                      <span className="material-symbols-outlined text-[#16A34A]" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    ) : (
                      <span className="material-symbols-outlined text-gray-300" style={{ fontSize: '20px' }}>radio_button_unchecked</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${done ? 'text-gray-400 line-through' : 'font-medium text-gray-700'}`}>
                        {task.title}
                      </p>
                    </div>
                  </div>
                )
              })
            )}

            {/* Show count of hidden tasks if more than 6 */}
            {data.recentTasks.length > 6 && (
              <p className="text-xs text-gray-400 pl-8">
                +{data.recentTasks.length - 6} more tasks
              </p>
            )}

            {/* Divider */}
            <div className="border-t border-gray-100" />

            {/* Pinned: EOD */}
            <div className="flex items-center gap-3">
              {data.dayIsClosed ? (
                <span className="material-symbols-outlined text-[#16A34A]" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              ) : (
                <span className="material-symbols-outlined text-gray-300" style={{ fontSize: '20px' }}>radio_button_unchecked</span>
              )}
              <p className={`text-sm ${data.dayIsClosed ? 'text-gray-400' : 'font-medium text-gray-700'}`}>
                End of Day Report
              </p>
            </div>
          </div>

          <Link
            href="/tasks"
            className="mt-4 w-full flex items-center justify-center py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600"
          >
            View Full Checklist
          </Link>
        </div>

        {/* ── Staff Task Leaderboard ── */}
        <div className="bg-white rounded-2xl p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic', color: '#2D2D2D' }}>
              Staff Activity
            </h2>
            <span className="text-xs font-semibold" style={{ color: '#296861' }}>Today</span>
          </div>

          {data.tasksByStaff.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-3">No tasks completed yet</p>
          ) : (
            <div className="space-y-2.5">
              {data.tasksByStaff.map((s, idx) => {
                const barWidth = data.tasksCompleted > 0
                  ? Math.round((s.count / data.tasksByStaff[0].count) * 100)
                  : 0
                const medal = idx === 0 ? '#B8960C' : idx === 1 ? '#9E9E9E' : idx === 2 ? '#CD7F32' : null
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    {/* Rank / medal */}
                    <div className="w-6 shrink-0 text-center">
                      {medal ? (
                        <span className="material-symbols-outlined" style={{ fontSize: '16px', color: medal, fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                      ) : (
                        <span className="text-xs font-bold text-gray-300">{idx + 1}</span>
                      )}
                    </div>

                    {/* Avatar */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{ background: 'linear-gradient(135deg, #296861 0%, #73b0a8 100%)' }}
                    >
                      {initials(s.full_name)}
                    </div>

                    {/* Name + bar */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between mb-1">
                        <p className="text-sm font-semibold truncate" style={{ color: '#2D2D2D' }}>{s.full_name}</p>
                        <span className="text-xs font-bold shrink-0 ml-2" style={{ color: '#296861' }}>{s.count}</span>
                      </div>
                      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${barWidth}%`, background: 'linear-gradient(90deg, #296861 0%, #73b0a8 100%)' }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Management links ── */}
        <div className="grid grid-cols-2 gap-3 pb-2">
          <Link href="/invoice" className="bg-white rounded-2xl p-4 flex flex-col gap-1 card-interactive">
            <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '22px' }}>receipt_long</span>
            <p className="font-semibold text-sm mt-1" style={{ color: '#2D2D2D' }}>Scan Invoice</p>
            <p className="text-xs text-gray-400">Inventory intake</p>
          </Link>
          <Link href="/eod" className="bg-white rounded-2xl p-4 flex flex-col gap-1 card-interactive">
            <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '22px' }}>nights_stay</span>
            <p className="font-semibold text-sm mt-1" style={{ color: '#2D2D2D' }}>End of Day</p>
            <p className="text-xs text-gray-400">Close the shift</p>
          </Link>
          <Link href="/admin/settings" className="bg-white rounded-2xl p-4 flex flex-col gap-1 card-interactive col-span-2">
            <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '22px' }}>manage_accounts</span>
            <p className="font-semibold text-sm mt-1" style={{ color: '#2D2D2D' }}>Settings</p>
            <p className="text-xs text-gray-400">Staff & configuration</p>
          </Link>
        </div>

      </div>
    </div>
  )
}

// ─── MANAGER DASHBOARD ────────────────────────────────────────────────────────

function ManagerDashboard({
  data,
  xeroConnected,
  name,
  onLogOut,
}: {
  data: DashboardData
  xeroConnected: boolean
  name: string
  onLogOut: () => void
}) {
  const taskPct = data.tasksTotal > 0 ? Math.round((data.tasksCompleted / data.tasksTotal) * 100) : 0

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#FAF8F3' }}>
      <DashboardHeader name={name} xeroConnected={xeroConnected} onLogOut={onLogOut} />

      {/* ── Shift Performance hero ── */}
      <div className="px-5 pt-4 pb-2">
        <p className="section-label mb-1" style={{ color: '#296861' }}>Current Shift Performance</p>
        <p className="text-5xl font-bold leading-none" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', color: '#2D2D2D' }}>
          {formatCurrency(data.invoicesTotal)}
        </p>
        <p className="text-sm text-gray-400 mt-1">
          <span className="text-[#16A34A] font-semibold">↑ {taskPct}%</span> task completion vs. shift target
        </p>
        {/* Action buttons */}
        <div className="flex gap-3 mt-3">
          <Link href="/eod" className="flex-1 py-2.5 rounded-xl border border-gray-300 text-center text-sm font-semibold text-gray-600">
            View Report
          </Link>
          <Link href="/results" className="flex-1 py-2.5 rounded-xl text-center text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #296861 0%, #73b0a8 100%)' }}>
            Daily Ledger
          </Link>
        </div>
      </div>

      <div className="px-5 space-y-4 mt-2">

        {/* ── Calibration card ── */}
        <CalibrationCard />

        {/* ── Operations ── */}
        <div>
          <p className="section-label mb-2" style={{ color: '#296861' }}>Operations</p>
          <div className="space-y-2">
            <Link href="/waste" className="flex items-center bg-white rounded-2xl px-4 py-3 gap-3 card-interactive">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#FFF8E7' }}>
                <span className="material-symbols-outlined" style={{ color: '#B8960C', fontSize: '20px' }}>delete</span>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm" style={{ color: '#2D2D2D' }}>Log Waste</p>
                <p className="text-xs" style={{ color: '#73b0a8' }}>Food & Beverage</p>
              </div>
              <span className="text-gray-300">›</span>
            </Link>
            <Link href="/invoice" className="flex items-center bg-white rounded-2xl px-4 py-3 gap-3 card-interactive">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#E6F4F1' }}>
                <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '20px' }}>receipt_long</span>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm" style={{ color: '#2D2D2D' }}>Scan Invoice</p>
                <p className="text-xs" style={{ color: '#73b0a8' }}>Inventory Intake</p>
              </div>
              <span className="text-gray-300">›</span>
            </Link>
          </div>
        </div>

        {/* ── Tasks Remaining ── */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="text-2xl font-bold" style={{ color: '#2D2D2D' }}>
              Tasks{' '}
              <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic' }}>Remaining</span>
            </h2>
            <span className="text-xl text-gray-300">···</span>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            {data.tasksCompleted} of {data.tasksTotal} completed for Morning Shift
          </p>

          <div className="space-y-2">
            {data.recentTasks.slice(0, 5).map((task) => {
              const done = !!task.completed_at
              return (
                <div key={task.id} className="bg-white rounded-2xl px-4 py-3 flex items-start gap-3">
                  {/* Square checkbox */}
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                    done ? 'border-[#296861]' : 'border-gray-300'
                  }`} style={done ? { backgroundColor: '#296861' } : {}}>
                    {done && <span className="material-symbols-outlined text-white" style={{ fontSize: '12px', fontVariationSettings: "'FILL' 1" }}>check</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold leading-tight ${done ? 'line-through text-gray-400' : ''}`} style={done ? {} : { color: '#2D2D2D' }}>
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="text-xs text-gray-400 mt-0.5 leading-tight">{task.description}</p>
                    )}
                  </div>
                  {done ? (
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: '#F0FDF4', color: '#16A34A' }}>Done</span>
                  ) : task.station === 'brew_bar' ? (
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: '#FFF8E7', color: '#C47F17' }}>Priority</span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0 bg-gray-100 text-gray-500">Routine</span>
                  )}
                </div>
              )
            })}

            {data.tasksTotal === 0 && (
              <div className="bg-white rounded-2xl p-4 text-center">
                <p className="text-sm text-gray-400">No tasks generated yet</p>
              </div>
            )}
          </div>

          {data.tasksTotal > 5 && (
            <Link href="/tasks" className="mt-2 flex items-center justify-center gap-1 text-sm font-semibold py-2" style={{ color: '#296861' }}>
              View all {data.tasksTotal} tasks
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
            </Link>
          )}
        </div>

        {/* ── Waste summary card ── */}
        <div className="bg-white rounded-2xl px-4 py-4 flex items-center gap-4 card-interactive">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#FFF8E7' }}>
            <span className="material-symbols-outlined" style={{ color: '#B8960C', fontSize: '22px' }}>delete</span>
          </div>
          <div className="flex-1">
            <p className="section-label">Waste Today</p>
            <p className="text-xl font-bold" style={{ color: '#2D2D2D' }}>{formatCurrency(data.wasteTotal)}</p>
          </div>
          <Link href="/waste" className="text-sm font-semibold" style={{ color: '#296861' }}>Log →</Link>
        </div>

        {/* ── Admin links ── */}
        <div className="grid grid-cols-2 gap-3 pb-2">
          <Link href="/results" className="bg-white rounded-2xl p-4 flex flex-col gap-1 card-interactive">
            <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '22px' }}>bar_chart</span>
            <p className="font-semibold text-sm mt-1" style={{ color: '#2D2D2D' }}>7-Day Results</p>
            <p className="text-xs text-gray-400">Performance</p>
          </Link>
          <Link href="/admin/tasks" className="bg-white rounded-2xl p-4 flex flex-col gap-1 card-interactive">
            <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '22px' }}>edit_note</span>
            <p className="font-semibold text-sm mt-1" style={{ color: '#2D2D2D' }}>Manage Tasks</p>
            <p className="text-xs text-gray-400">Templates</p>
          </Link>
        </div>

      </div>
    </div>
  )
}

// ─── STAFF / BARISTA DASHBOARD ────────────────────────────────────────────────

function StaffDashboard({
  data,
  xeroConnected,
  name,
  cafeDay,
  onLogOut,
}: {
  data: DashboardData
  xeroConnected: boolean
  name: string
  cafeDay: string
  onLogOut: () => void
}) {
  const firstName   = name.split(' ')[0]
  const greeting    = getGreeting()
  const progress    = shiftProgress()
  const taskPct     = data.tasksTotal > 0 ? Math.round((data.tasksCompleted / data.tasksTotal) * 100) : 0

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      <DashboardHeader name={name} xeroConnected={xeroConnected} onLogOut={onLogOut} />

      {/* ── Greeting ── */}
      <div className="px-5 pt-4 pb-3">
        <p className="section-label mb-1" style={{ color: '#296861' }}>Staff Portal</p>
        <h1 className="text-4xl font-bold leading-tight" style={{ color: '#2D2D2D' }}>
          {greeting},{' '}
          <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic', display: 'block' }}>
            {firstName}.
          </span>
        </h1>
      </div>

      <div className="px-5 space-y-4">

        {/* ── Shift Progress ── */}
        <div className="bg-white rounded-2xl p-4 card-interactive">
          <p className="section-label mb-1">Shift Progress</p>
          <div className="flex items-end gap-1">
            <p className="text-5xl font-bold" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', color: '#2D2D2D' }}>
              {progress}
            </p>
            <p className="text-2xl font-semibold mb-1 text-gray-400">%</p>
          </div>
          <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #296861 0%, #73b0a8 100%)' }}
            />
          </div>
        </div>

        {/* ── Today's date card ── */}
        <div className="bg-white rounded-2xl px-4 py-3 flex items-center gap-3">
          <span className="material-symbols-outlined text-gray-400" style={{ fontSize: '20px' }}>calendar_today</span>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#2D2D2D' }}>{formatDisplayDate(cafeDay)}</p>
            <p className="text-xs text-gray-400">Morning Shift · Main Floor</p>
          </div>
        </div>

        {/* ── Calibration card ── */}
        <CalibrationCard />

        {/* ── Quick action cards ── */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { href: '/calibration', icon: 'tune',         label: 'Calibrate' },
            { href: '/waste',       icon: 'delete',        label: 'Log Waste' },
            { href: '/invoice',     icon: 'receipt_long',  label: 'Scan Invoice' },
            { href: '/eod',         icon: 'nights_stay',   label: 'End of Day' },
          ].map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="bg-white rounded-2xl p-4 flex flex-col items-center gap-2 card-interactive"
            >
              <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '24px' }}>{item.icon}</span>
              <p className="text-[11px] font-semibold text-center text-gray-500">{item.label}</p>
            </Link>
          ))}
        </div>

        {/* ── Daily Checklist ── */}
        <div className="bg-white rounded-2xl p-4 card-interactive">
          <div className="flex items-baseline justify-between mb-1">
            <p className="font-bold text-lg" style={{ color: '#2D2D2D' }}>
              Daily{' '}
              <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic' }}>Checklist</span>
            </p>
            <p className="text-xs text-gray-400">{data.tasksCompleted} of {data.tasksTotal} tasks</p>
          </div>
          <p className="text-xs text-gray-400 mb-3">Essential floor management tasks.</p>

          {/* Efficiency bar */}
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">Efficiency</p>
            <p className="section-label" style={{ color: taskEffColour(taskPct) }}>{taskPct}%</p>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div
              className="h-full rounded-full"
              style={{ width: `${taskPct}%`, backgroundColor: taskEffColour(taskPct) }}
            />
          </div>

          {data.recentTasks.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-2">No tasks yet today</p>
          ) : (
            <div className="space-y-2">
              {data.recentTasks.slice(0, 4).map(task => {
                const done = !!task.completed_at
                return (
                  <div key={task.id} className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                      done ? 'border-[#296861]' : 'border-gray-300'
                    }`} style={done ? { backgroundColor: '#296861' } : {}}>
                      {done && <span className="material-symbols-outlined text-white" style={{ fontSize: '11px', fontVariationSettings: "'FILL' 1" }}>check</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-tight ${done ? 'line-through text-gray-400' : ''}`} style={done ? {} : { color: '#2D2D2D' }}>
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-[11px] text-gray-400 uppercase tracking-wide mt-0.5">{task.description}</p>
                      )}
                    </div>
                    {!done && (
                      <span className="material-symbols-outlined text-gray-300" style={{ fontSize: '18px' }}>drag_indicator</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {data.tasksTotal > 0 && (
            <Link
              href="/tasks"
              className="mt-3 flex items-center justify-center gap-1 text-sm font-semibold"
              style={{ color: '#296861' }}
            >
              Open full checklist
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
            </Link>
          )}
        </div>

        {/* ── Day status banner ── */}
        {data.dayIsClosed ? (
          <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ backgroundColor: '#E6F4F1' }}>
            <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <p className="text-sm font-semibold" style={{ color: '#296861' }}>Day closed · EOD submitted</p>
          </div>
        ) : (
          <Link href="/eod" className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 card-interactive">
            <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '20px' }}>nights_stay</span>
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: '#2D2D2D' }}>End of Day</p>
              <p className="text-xs text-gray-400">Submit shift report</p>
            </div>
            <span className="text-gray-300">›</span>
          </Link>
        )}

      </div>
    </div>
  )
}

// ─── ROOT PAGE ────────────────────────────────────────────────────────────────

/** Main dashboard — renders one of three role-specific views */
export default function DashboardPage() {
  const { profile, loading } = useAuth()
  const { isManager, isOwner } = useRole()
  const router = useRouter()

  const [data, setData] = useState<DashboardData>({
    tasksCompleted: 0,
    tasksTotal: 0,
    wasteTotal: 0,
    dayIsClosed: false,
    invoicesTotal: 0,
    invoicesCount: 0,
    calibrationCount: 0,
    incompleteTasks: [],
    recentTasks: [],
    staffProfiles: [],
    tasksByStaff: [],
  })
  const [xeroConnected, setXeroConnected] = useState(false)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
  }, [profile, loading, router])

  // Fetch all dashboard data
  useEffect(() => {
    if (!profile) return

    async function fetchData() {
      const supabase = createClient()
      const cafeDay  = getCurrentCafeDay()

      const [tasksRes, wasteRes, eodRes, invoicesRes, calRes, staffRes] = await Promise.all([
        supabase.from('daily_tasks').select('*').eq('cafe_day', cafeDay).order('created_at'),
        supabase.from('waste_logs').select('total_cost').eq('cafe_day', cafeDay),
        supabase.from('eod_reports').select('id').eq('cafe_day', cafeDay).single(),
        supabase.from('invoices').select('total_amount').eq('cafe_day', cafeDay),
        supabase.from('calibrations').select('id').eq('cafe_day', cafeDay),
        supabase.from('profiles').select('id, full_name, role').eq('is_active', true),
      ])

      const tasks            = (tasksRes.data as DailyTask[]) ?? []
      const tasksCompleted   = tasks.filter(t => t.completed_at).length
      const wasteTotal       = wasteRes.data?.reduce((s, w) => s + w.total_cost, 0) ?? 0
      const invoicesTotal    = invoicesRes.data?.reduce((s, i) => s + i.total_amount, 0) ?? 0
      const staffList        = (staffRes.data ?? []) as Pick<Profile, 'id' | 'full_name' | 'role'>[]

      // Count completed tasks per staff member for today's leaderboard
      const countMap: Record<string, number> = {}
      tasks.filter(t => t.completed_by).forEach(t => {
        countMap[t.completed_by!] = (countMap[t.completed_by!] ?? 0) + 1
      })
      const tasksByStaff: StaffTaskCount[] = staffList
        .map(s => ({ id: s.id, full_name: s.full_name, role: s.role, count: countMap[s.id] ?? 0 }))
        .filter(s => s.count > 0)
        .sort((a, b) => b.count - a.count)

      setData({
        tasksCompleted,
        tasksTotal:        tasks.length,
        wasteTotal,
        dayIsClosed:       !!eodRes.data,
        invoicesTotal,
        invoicesCount:     invoicesRes.data?.length ?? 0,
        calibrationCount:  calRes.data?.length ?? 0,
        incompleteTasks:   tasks.filter(t => !t.completed_at),
        recentTasks:       tasks,
        staffProfiles:     staffList,
        tasksByStaff,
      })
    }

    fetchData()
  }, [profile])

  // Xero connection status (RLS: only owner sees a row)
  useEffect(() => {
    if (!profile) return
    createClient()
      .from('xero_tokens')
      .select('id')
      .single()
      .then(({ data: d }) => setXeroConnected(!!d))
  }, [profile])

  // Sign out helper
  async function handleLogOut() {
    const { signOut } = await import('@/lib/auth')
    await signOut()
    router.push('/login')
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#296861', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  const cafeDay  = getCurrentCafeDay()
  const fullName = profile.full_name

  if (isOwner) {
    return <OwnerDashboard data={data} xeroConnected={xeroConnected} name={fullName} cafeDay={cafeDay} onLogOut={handleLogOut} />
  }

  if (isManager) {
    return <ManagerDashboard data={data} xeroConnected={xeroConnected} name={fullName} onLogOut={handleLogOut} />
  }

  return <StaffDashboard data={data} xeroConnected={xeroConnected} name={fullName} cafeDay={cafeDay} onLogOut={handleLogOut} />
}
