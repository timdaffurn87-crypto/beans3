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
        <div className="w-8 h-8 border-4 border-[#296861] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Live ratio calculation from current dose/yield inputs
  const liveRatio = calculateRatio(parseFloat(dose), parseFloat(yield_))

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>

      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <p className="section-label mb-3" style={{ color: '#296861' }}>DAILY RITUAL</p>
        <h1 className="text-4xl font-bold" style={{ color: '#2D2D2D' }}>
          Coffee
          <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic', display: 'block' }}>
            Calibration
          </span>
        </h1>
        {/* Gold horizontal accent bar */}
        <div className="w-12 h-1 rounded-full mt-3" style={{ backgroundColor: '#B8960C' }} />
      </div>

      <div className="px-5 space-y-5">

        {/* Precision Metrics card — calibration form */}
        <div className="bg-white rounded-2xl p-5 space-y-4">
          {/* Card header */}
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ color: '#296861', fontSize: '20px' }}>tune</span>
            <p className="font-semibold text-sm" style={{ color: '#2D2D2D' }}>Precision Metrics</p>
          </div>

          {/* 2×2 grid of inputs: Grinder, Dose, Yield, Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="section-label" htmlFor="grinder-setting">Grinder Setting</label>
              <input
                id="grinder-setting"
                type="number"
                step="0.5"
                value={grinderSetting}
                onChange={e => setGrinderSetting(e.target.value)}
                placeholder="e.g. 3.5"
                className="bg-[#f1ede7] rounded-xl border-0 border-b-2 border-transparent px-4 py-3 text-base focus:outline-none focus:border-[#296861]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="section-label" htmlFor="dose">Dose (g)</label>
              <input
                id="dose"
                type="number"
                step="0.1"
                value={dose}
                onChange={e => setDose(e.target.value)}
                placeholder="e.g. 22.0"
                className="bg-[#f1ede7] rounded-xl border-0 border-b-2 border-transparent px-4 py-3 text-base focus:outline-none focus:border-[#296861]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="section-label" htmlFor="yield">Yield (g)</label>
              <input
                id="yield"
                type="number"
                step="0.1"
                value={yield_}
                onChange={e => setYield(e.target.value)}
                placeholder="e.g. 36.0"
                className="bg-[#f1ede7] rounded-xl border-0 border-b-2 border-transparent px-4 py-3 text-base focus:outline-none focus:border-[#296861]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="section-label" htmlFor="time">Time (s)</label>
              <input
                id="time"
                type="number"
                step="1"
                value={time}
                onChange={e => setTime(e.target.value)}
                placeholder="e.g. 28"
                className="bg-[#f1ede7] rounded-xl border-0 border-b-2 border-transparent px-4 py-3 text-base focus:outline-none focus:border-[#296861]"
              />
            </div>
          </div>

          {/* Notes textarea */}
          <div className="flex flex-col gap-1">
            <label className="section-label" htmlFor="notes">
              Notes <span className="normal-case font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Pulled slightly sour, adjusted 0.5 finer"
              rows={2}
              className="bg-[#f1ede7] rounded-xl border-0 border-b-2 border-transparent px-4 py-3 text-base focus:outline-none focus:border-[#296861] resize-none"
            />
          </div>

          {/* Submit button — teal gradient pill */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 rounded-full text-white font-semibold uppercase tracking-wide flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #296861 0%, #73b0a8 100%)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>coffee</span>
            {submitting ? 'Logging…' : 'Log Calibration'}
          </button>
        </div>

        {/* Target Ratio card — amber, shows live calculated ratio */}
        <div className="rounded-2xl p-5 card-interactive" style={{ backgroundColor: '#FFF8E7' }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined" style={{ color: '#C47F17', fontSize: '20px' }}>calculate</span>
            <p className="font-semibold text-sm" style={{ color: '#C47F17' }}>Target Ratio</p>
          </div>
          <p className="text-xs mb-3" style={{ color: '#C47F17', opacity: 0.7 }}>Extraction sweet spot</p>
          <p className="text-5xl font-bold" style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', color: '#C47F17' }}>
            {liveRatio !== '—' ? liveRatio : '1:2'}
          </p>
          <div className="flex items-center justify-between mt-3">
            <p className="section-label">Extraction sweet spot</p>
            {liveRatio !== '—' && <p className="section-label" style={{ color: '#296861' }}>Live</p>}
          </div>
          <div className="mt-2 h-1 rounded-full" style={{ background: 'linear-gradient(90deg, #296861 0%, #73b0a8 100%)' }} />
        </div>

        {/* Today's calibration history */}
        <div>
          {/* Section heading with count badge */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold" style={{ color: '#2D2D2D' }}>
              Today&apos;s{' '}
              <span style={{ fontFamily: 'var(--font-newsreader), Georgia, serif', fontStyle: 'italic' }}>
                Calibrations
              </span>
            </h2>
            {!loadingHistory && (
              <span className="section-label" style={{ color: '#296861' }}>
                {history.length} TOTAL RUNS
              </span>
            )}
          </div>

          {loadingHistory ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-4 border-[#296861] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            /* Empty state */
            <div className="bg-white rounded-2xl p-8 text-center">
              <span className="material-symbols-outlined text-gray-200 block mb-2" style={{ fontSize: '48px' }}>coffee</span>
              <p className="text-gray-400 text-sm">No calibrations logged today</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((entry, index) => (
                /* Numbered entry card with left teal border */
                <div
                  key={entry.id}
                  className="bg-white rounded-2xl p-4 card-interactive"
                  style={{ borderLeft: '3px solid #296861' }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {/* Large muted run number in Newsreader serif */}
                      <span
                        className="text-3xl font-bold"
                        style={{ color: '#E8E2D2', fontFamily: 'var(--font-newsreader), Georgia, serif' }}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div>
                        <p className="text-xs text-gray-400">{formatTime(entry.created_at)}</p>
                        <p className="font-semibold text-sm" style={{ color: '#2D2D2D' }}>
                          {entry.profiles?.full_name ?? 'Unknown'}
                        </p>
                        {/* Key metrics row */}
                        <div className="flex gap-4 mt-2">
                          <div>
                            <p className="section-label">Grind</p>
                            <p className="text-sm font-semibold">{entry.grinder_setting}</p>
                          </div>
                          <div>
                            <p className="section-label">Ratio</p>
                            <p className="text-sm font-semibold">{calculateRatio(entry.dose_grams, entry.yield_grams)}</p>
                          </div>
                          <div>
                            <p className="section-label">Time</p>
                            <p className="text-sm font-semibold">{entry.time_seconds}s</p>
                          </div>
                        </div>
                        {entry.notes && (
                          <p className="text-xs text-gray-400 mt-1 italic">{entry.notes}</p>
                        )}
                      </div>
                    </div>
                    <span className="material-symbols-outlined text-gray-300" style={{ fontSize: '20px' }}>open_in_new</span>
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
