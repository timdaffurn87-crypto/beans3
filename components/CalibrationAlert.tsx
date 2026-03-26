'use client'

import Link from 'next/link'
import { useCalibration } from '@/hooks/useCalibration'
import { formatTime } from '@/lib/utils'

/** Displays a red "CALIBRATION OVERDUE" banner or a green "Calibrated" badge */
export function CalibrationAlert() {
  const { lastCalibration, isOverdue, loading } = useCalibration()

  if (loading) return null

  if (isOverdue) {
    return (
      <Link href="/calibration">
        <div className="bg-[#DC2626] rounded-2xl p-5 text-white animate-pulse-red cursor-pointer active:scale-[0.98] transition-transform">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase opacity-80 mb-1">
                Action Required
              </p>
              <h2 className="text-2xl font-bold tracking-tight">CALIBRATION OVERDUE</h2>
              <p className="text-sm opacity-80 mt-1">
                {lastCalibration
                  ? `Last calibrated at ${formatTime(lastCalibration)}`
                  : 'Not yet calibrated today'}
              </p>
            </div>
            <span className="text-4xl opacity-60">☕</span>
          </div>
          <div className="mt-3 bg-white/20 rounded-xl px-4 py-2 text-center text-sm font-semibold">
            Tap to Calibrate Now →
          </div>
        </div>
      </Link>
    )
  }

  return (
    <div className="bg-[#16A34A] rounded-2xl px-4 py-3 text-white flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold">Calibrated ✓</p>
        {lastCalibration && (
          <p className="text-xs opacity-80">Last at {formatTime(lastCalibration)}</p>
        )}
      </div>
      <span className="text-2xl">✓</span>
    </div>
  )
}
