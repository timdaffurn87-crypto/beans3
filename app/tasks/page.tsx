'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useRole } from '@/hooks/useRole'
import { createClient } from '@/lib/supabase'
import { getCurrentCafeDay } from '@/lib/cafe-day'
import { formatTime } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { logActivity } from '@/lib/activity'
import type { DailyTask, Profile } from '@/lib/types'

/** Maps station keys to human-readable display names */
function stationDisplayName(station: string): string {
  const map: Record<string, string> = {
    brew_bar: 'Brew Bar',
    kitchen: 'Kitchen',
    front_counter: 'Front Counter',
    cleaning: 'Cleaning',
  }
  if (map[station]) return map[station]
  // Fall back to title-casing anything unknown
  return station
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Daily Tasks page — all roles complete tasks, manager/owner access template editor */
export default function TasksPage() {
  const { profile, loading } = useAuth()
  const { isManager, isOwner, isKitchen } = useRole()
  const router = useRouter()
  const { showToast } = useToast()

  const [tasks, setTasks] = useState<DailyTask[]>([])
  const [profiles, setProfiles] = useState<Pick<Profile, 'id' | 'full_name'>[]>([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [generating, setGenerating] = useState(false)

  // Auth guard — redirect to login if no profile
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
  }, [profile, loading, router])

  /** Fetch all staff profiles for name lookups */
  async function fetchProfiles() {
    const supabase = createClient()
    const { data } = await supabase.from('profiles').select('id, full_name')
    setProfiles(data ?? [])
  }

  /**
   * Generate daily tasks for today's café day via server-side API route.
   * The API uses the service role key to bypass the daily_tasks INSERT RLS restriction.
   * Idempotent — does nothing if tasks already exist for that day.
   */
  async function generateDailyTasks(cafeDay: string) {
    await fetch('/api/tasks/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cafeDay }),
    })
  }

  /** Fetch today's tasks */
  const fetchTasks = useCallback(async () => {
    const supabase = createClient()
    const cafeDay = getCurrentCafeDay()

    const { data } = await supabase
      .from('daily_tasks')
      .select('*')
      .eq('cafe_day', cafeDay)
      .order('station')
      .order('created_at')

    setTasks((data as DailyTask[]) ?? [])
    setLoadingTasks(false)
  }, [])

  /** On load: check for tasks, generate if missing, then fetch */
  useEffect(() => {
    if (!profile) return

    async function init() {
      setGenerating(true)
      await fetchProfiles()
      const cafeDay = getCurrentCafeDay()
      await generateDailyTasks(cafeDay)
      await fetchTasks()
      setGenerating(false)
    }

    init()
  }, [profile, fetchTasks])

  /**
   * Mark a task as complete with the current user's id and a timestamp.
   * Uses optimistic UI — updates local state immediately, then persists.
   */
  async function completeTask(taskId: string) {
    if (!profile) return

    // Find the task title for the activity log
    const task = tasks.find(t => t.id === taskId)
    const now = new Date().toISOString()

    // Optimistic update
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId
          ? { ...t, completed_by: profile.id, completed_at: now }
          : t
      )
    )

    const supabase = createClient()
    const { error } = await supabase
      .from('daily_tasks')
      .update({ completed_by: profile.id, completed_at: now })
      .eq('id', taskId)

    if (error) {
      showToast('Failed to save — please try again', 'error')
      // Roll back optimistic update on failure
      setTasks(prev =>
        prev.map(t =>
          t.id === taskId
            ? { ...t, completed_by: null, completed_at: null }
            : t
        )
      )
    } else if (task) {
      // Log activity after successful completion
      await logActivity(profile.id, 'task_completed', `Completed task: ${task.title}`)
    }
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Kitchen role only sees kitchen station tasks
  const visibleTasks = isKitchen ? tasks.filter(t => t.station === 'kitchen') : tasks

  const completedCount = visibleTasks.filter(t => t.completed_at).length
  const totalCount = visibleTasks.length
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  // Group tasks by station, preserving order from the query
  const stations = Array.from(new Set(visibleTasks.map(t => t.station)))

  /** Look up a staff name from the fetched profiles array */
  function staffName(id: string | null): string {
    if (!id) return 'Unknown'
    return profiles.find(p => p.id === id)?.full_name ?? 'Unknown'
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-2">
        <p className="section-label mb-2" style={{ color: '#296861' }}>Morning Shift</p>
        <div className="flex items-end justify-between">
          <h1 className="text-4xl font-bold leading-none" style={{ color: '#2D2D2D' }}>
            Daily
            <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic', display: 'block' }}>
              Tasks
            </span>
          </h1>
          {(isManager || isOwner) && (
            <Link href="/admin/tasks" className="flex items-center gap-1 text-sm font-semibold pb-1" style={{ color: '#296861' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit_note</span>
              Manage Templates
            </Link>
          )}
        </div>
        <p className="text-sm mt-1 text-gray-400" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic' }}>
          Precision in every detail.
        </p>
        <div className="w-10 h-0.5 rounded-full mt-3" style={{ backgroundColor: '#B8960C' }} />
      </div>

      <div className="px-5 pt-4 space-y-5">
        {/* Progress card */}
        {!generating && totalCount > 0 && (
          <div className="bg-white rounded-2xl p-4 card-interactive">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '18px' }}>checklist</span>
                <p className="text-sm font-semibold" style={{ color: '#2D2D2D' }}>
                  {completedCount} of {totalCount} complete
                </p>
              </div>
              <p className="text-sm font-bold" style={{ color: completedCount === totalCount ? '#16A34A' : '#296861' }}>
                {Math.round(progressPct)}%
              </p>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progressPct}%`,
                  background: completedCount === totalCount ? '#16A34A' : 'linear-gradient(90deg, #296861 0%, #73b0a8 100%)',
                }}
              />
            </div>
          </div>
        )}

        {/* Generating spinner */}
        {generating && (
          <div className="bg-white rounded-2xl p-6 flex items-center gap-3 justify-center">
            <div className="w-5 h-5 border-3 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">Generating today's tasks…</p>
          </div>
        )}

        {/* Loading tasks spinner */}
        {!generating && loadingTasks && (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Empty state — no templates set up yet */}
        {!generating && !loadingTasks && totalCount === 0 && (
          <div className="bg-white rounded-2xl p-8 text-center">
            <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '48px' }}>checklist</span>
            <p className="font-semibold mt-3" style={{ color: '#2D2D2D' }}>No tasks for today</p>
            {(isManager || isOwner) ? (
              <p className="text-sm text-gray-400 mt-1">
                Add templates in{' '}
                <Link href="/admin/tasks" className="font-medium" style={{ color: '#296861' }}>
                  Manage Templates
                </Link>{' '}
                to get started.
              </p>
            ) : (
              <p className="text-sm text-gray-400 mt-1">No task templates have been set up yet.</p>
            )}
          </div>
        )}

        {/* Tasks grouped by station */}
        {!generating && !loadingTasks && stations.map(station => {
          const stationTasks = visibleTasks.filter(t => t.station === station)
          return (
            <div key={station}>
              {/* Station header with left bar accent */}
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-4 rounded-full" style={{ backgroundColor: '#296861' }} />
                <p className="section-label">{stationDisplayName(station)}</p>
              </div>

              <div className="space-y-2">
                {stationTasks.map(task => {
                  const isComplete = !!task.completed_at
                  return (
                    <button
                      key={task.id}
                      onClick={() => !isComplete && completeTask(task.id)}
                      className="bg-white rounded-2xl p-4 card-interactive w-full text-left"
                      disabled={isComplete}
                    >
                      <div className="flex items-start gap-3">
                        {/* Square checkbox — rounded-md, teal fill when complete */}
                        <div className={`w-8 h-8 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                          isComplete
                            ? 'border-[#296861]'
                            : 'border-gray-300 bg-white'
                        }`}
                          style={isComplete ? { backgroundColor: '#296861' } : {}}
                        >
                          {isComplete && (
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                            </svg>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          {/* Title */}
                          <p className={`font-bold text-base ${isComplete ? 'line-through text-gray-400' : ''}`}
                            style={isComplete ? {} : { color: '#2D2D2D' }}
                          >
                            {task.title}
                          </p>

                          {/* Description */}
                          {task.description && (
                            <p className="text-sm text-gray-400 mt-0.5">{task.description}</p>
                          )}

                          {/* Tags row — station chip + done badge */}
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                              {stationDisplayName(task.station)}
                            </span>
                            {isComplete && (
                              <span
                                className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: '#DCFCE7', color: '#16A34A' }}
                              >
                                Done
                              </span>
                            )}
                          </div>

                          {/* Who completed it */}
                          {isComplete && task.completed_at && (
                            <p className="text-xs mt-1" style={{ color: '#296861' }}>
                              ✓ {staffName(task.completed_by)} · {formatTime(task.completed_at)}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
