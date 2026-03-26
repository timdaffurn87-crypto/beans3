'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { getCurrentCafeDay } from '@/lib/cafe-day'
import { formatTime, calculateRatio } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { logActivity } from '@/lib/activity'
import type { Calibration, Profile } from '@/lib/types'

/** Calibration record joined with the logger's profile */
interface CalibrationWithProfile extends Calibration {
  profiles: Pick<Profile, 'full_name'> | null
}

/** Coffee Calibration page — all roles */
export default function CalibrationPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()

  // Form state
  const [grinderSetting, setGrinderSetting] = useState('')
  const [dose, setDose] = useState('')
  const [yield_, setYield] = useState('')
  const [time, setTime] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // History state
  const [history, setHistory] = useState<CalibrationWithProfile[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  // Auth guard — redirect to login if no profile
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
  }, [profile, loading, router])

  /** Fetch today's calibration history with staff names */
  async function fetchHistory() {
    const supabase = createClient()
    const cafeDay = getCurrentCafeDay()

    const { data } = await supabase
      .from('calibrations')
      .select('*, profiles(full_name)')
      .eq('cafe_day', cafeDay)
      .order('created_at', { ascending: false })

    setHistory((data as CalibrationWithProfile[]) ?? [])
    setLoadingHistory(false)
  }

  useEffect(() => {
    if (profile) fetchHistory()
  }, [profile])

  /** Submit a new calibration entry */
  async function handleSubmit() {
    if (!profile) return
    if (!grinderSetting) { showToast('Enter grinder setting', 'error'); return }
    if (!dose) { showToast('Enter dose (g)', 'error'); return }
    if (!yield_) { showToast('Enter yield (g)', 'error'); return }
    if (!time) { showToast('Enter time (s)', 'error'); return }

    setSubmitting(true)
    const supabase = createClient()
    const cafeDay = getCurrentCafeDay()

    const { error } = await supabase.from('calibrations').insert({
      staff_id: profile.id,
      grinder_setting: parseFloat(grinderSetting),
      dose_grams: parseFloat(dose),
      yield_grams: parseFloat(yield_),
      time_seconds: parseFloat(time),
      notes: notes.trim() || null,
      cafe_day: cafeDay,
    })

    setSubmitting(false)

    if (error) {
      showToast(error.message, 'error')
      return
    }

    showToast('Calibration logged ✓', 'success')
    // Log activity
    await logActivity(
      profile.id,
      'calibration_logged',
      `Calibration logged: grinder ${grinderSetting}, dose ${dose}g, yield ${yield_}g, time ${time}s`
    )
    // Clear form
    setGrinderSetting('')
    setDose('')
    setYield('')
    setTime('')
    setNotes('')
    // Refresh history
    fetchHistory()
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Live ratio calculation from current dose/yield inputs
  const liveRatio = calculateRatio(parseFloat(dose), parseFloat(yield_))

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <button onClick={() => router.back()} className="text-[#B8960C] text-sm mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Coffee Calibration</h1>
        <p className="text-sm text-gray-400 mt-1">Dial-In Log</p>
      </div>

      <div className="px-5 space-y-6">
        {/* Calibration form */}
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
          <h2 className="font-semibold text-[#1A1A1A]">Log Calibration</h2>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Grinder Setting</label>
            <input
              type="number"
              step="0.5"
              value={grinderSetting}
              onChange={e => setGrinderSetting(e.target.value)}
              placeholder="e.g. 3.5"
              className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Dose (g)</label>
              <input
                type="number"
                step="0.1"
                value={dose}
                onChange={e => setDose(e.target.value)}
                placeholder="e.g. 22.0"
                className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Yield (g)</label>
              <input
                type="number"
                step="0.1"
                value={yield_}
                onChange={e => setYield(e.target.value)}
                placeholder="e.g. 36.0"
                className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Time (s)</label>
              <input
                type="number"
                step="1"
                value={time}
                onChange={e => setTime(e.target.value)}
                placeholder="e.g. 28"
                className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
              />
            </div>
          </div>

          {/* Live ratio display — updates as dose/yield change */}
          <div className="px-4 py-3 bg-[#FAF8F3] rounded-xl flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">Ratio</span>
            <span className="text-lg font-bold text-[#B8960C]">{liveRatio}</span>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Pulled slightly sour, adjusted 0.5 finer"
              rows={2}
              className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C] resize-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
          >
            {submitting ? 'Logging…' : 'Log Calibration'}
          </button>
        </div>

        {/* Today's calibration history */}
        <div>
          <p className="section-label mb-3">Today's Calibrations</p>

          {loadingHistory ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
              <p className="text-gray-400 text-sm">No calibrations logged today</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map(entry => (
                <div key={entry.id} className="bg-white rounded-2xl p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[#1A1A1A] text-sm">
                          Grinder {entry.grinder_setting}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#B8960C]/10 text-[#B8960C] font-medium">
                          {calculateRatio(entry.dose_grams, entry.yield_grams)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-0.5">
                        {entry.dose_grams}g in · {entry.yield_grams}g out · {entry.time_seconds}s
                      </p>
                      {entry.notes && (
                        <p className="text-xs text-gray-400 mt-1 italic">{entry.notes}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {entry.profiles?.full_name ?? 'Unknown'} · {formatTime(entry.created_at)}
                      </p>
                    </div>
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
