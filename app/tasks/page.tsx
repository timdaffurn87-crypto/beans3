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
import type { DailyTask, Profile, TaskTemplate } from '@/lib/types'

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
  const { isManager, isOwner } = useRole()
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
   * Generate daily tasks from active templates for today's café day.
   * Only inserts if no tasks exist yet — idempotent.
   */
  async function generateDailyTasks(cafeDay: string) {
    const supabase = createClient()

    // Check if tasks already exist for today
    const { count } = await supabase
      .from('daily_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('cafe_day', cafeDay)

    if ((count ?? 0) > 0) return // Already generated — do nothing

    // Fetch all active task templates
    const { data: templates } = await supabase
      .from('task_templates')
      .select('*')
      .eq('is_active', true)
      .order('station')
      .order('sort_order')

    if (!templates || templates.length === 0) return

    // Insert a daily_task row for each template
    const rows = (templates as TaskTemplate[]).map(t => ({
      template_id: t.id,
      cafe_day: cafeDay,
      title: t.title,
      description: t.description,
      station: t.station,
    }))

    await supabase.from('daily_tasks').insert(rows)
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

  const completedCount = tasks.filter(t => t.completed_at).length
  const totalCount = tasks.length
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  // Group tasks by station, preserving order from the query
  const stations = Array.from(new Set(tasks.map(t => t.station)))

  /** Look up a staff name from the fetched profiles array */
  function staffName(id: string | null): string {
    if (!id) return 'Unknown'
    return profiles.find(p => p.id === id)?.full_name ?? 'Unknown'
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-4">
        <button onClick={() => router.back()} className="text-[#B8960C] text-sm mb-3 flex items-center gap-1">
          ← Back
        </button>
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Daily Tasks</h1>
          {(isManager || isOwner) && (
            <Link
              href="/admin/tasks"
              className="text-sm font-semibold text-[#B8960C] mt-1"
            >
              Manage Templates
            </Link>
          )}
        </div>
      </div>

      <div className="px-5 space-y-5">
        {/* Progress indicator */}
        {!generating && totalCount > 0 && (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-600">Progress</p>
              <p className="text-sm font-semibold text-[#1A1A1A]">
                {completedCount} of {totalCount} complete
              </p>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#16A34A] rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Generating spinner */}
        {generating && (
          <div className="bg-white rounded-2xl p-6 shadow-sm flex items-center gap-3 justify-center">
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
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <p className="font-semibold text-[#1A1A1A]">No tasks for today</p>
            {(isManager || isOwner) ? (
              <p className="text-sm text-gray-400 mt-1">
                Add templates in{' '}
                <Link href="/admin/tasks" className="text-[#B8960C] font-medium">
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
          const stationTasks = tasks.filter(t => t.station === station)
          return (
            <div key={station}>
              <p className="section-label mb-2">{stationDisplayName(station)}</p>
              <div className="space-y-2">
                {stationTasks.map(task => {
                  const isComplete = !!task.completed_at
                  return (
                    <button
                      key={task.id}
                      onClick={() => !isComplete && completeTask(task.id)}
                      className="w-full bg-white rounded-2xl p-4 shadow-sm text-left active:scale-[0.99] transition-transform"
                      style={{ minHeight: 56 }}
                      disabled={isComplete}
                    >
                      <div className="flex items-start gap-3">
                        {/* Custom checkbox */}
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                          isComplete
                            ? 'bg-[#B8960C] border-[#B8960C]'
                            : 'border-gray-300 bg-white'
                        }`}>
                          {isComplete && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                            </svg>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className={`font-semibold text-sm ${isComplete ? 'line-through text-gray-400' : 'text-[#1A1A1A]'}`}>
                            {task.title}
                          </p>
                          {task.description && (
                            <p className="text-xs text-gray-400 mt-0.5">{task.description}</p>
                          )}
                          {isComplete && task.completed_at && (
                            <p className="text-xs text-[#16A34A] mt-1 font-medium">
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
