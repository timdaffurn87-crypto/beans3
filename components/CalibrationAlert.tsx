'use client'

import Link from 'next/link'
import { useCalibration } from '@/hooks/useCalibration'
import { formatTime } from '@/lib/utils'

/**
 * CalibrationAlert — highest-priority element on the dashboard.
 *
 * OVERDUE: Glassmorphism card with terracotta border and pulsing ring.
 *   Feels important and calm rather than alarming, while remaining impossible
 *   to miss through size, typography, and the animated ring.
 *
 * OK: Small matcha green badge showing the last calibration time.
 */
export function CalibrationAlert() {
  const { lastCalibration, isOverdue, loading } = useCalibration()

  if (loading) return null

  if (isOverdue) {
    return (
      <Link href="/calibration">
        <div
          className="rounded-[var(--radius-lg)] p-5 cursor-pointer animate-pulse-terracotta card-interactive"
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            border: '2px solid var(--alert-terracotta)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              {/* Spaced uppercase label in terracotta */}
              <p className="section-label mb-1" style={{ color: 'var(--alert-terracotta)' }}>
                Action Required
              </p>

              {/* Playfair Display heading via h2 rule in globals.css */}
              <h2
                className="text-2xl font-bold tracking-tight"
                style={{ color: 'var(--alert-terracotta)' }}
              >
                Calibration Overdue
              </h2>

              {/* Last calibration timestamp */}
              <p className="text-sm mt-1" style={{ color: 'var(--alert-terracotta)', opacity: 0.7 }}>
                {lastCalibration
                  ? `Last calibrated at ${formatTime(lastCalibration)}`
                  : 'Not yet calibrated today'}
              </p>
            </div>

            <span className="text-3xl opacity-40 shrink-0 mt-0.5">☕</span>
          </div>

          {/* CTA strip — solid terracotta pill */}
          <div
            className="mt-4 rounded-[var(--radius-md)] px-4 py-2.5 text-center text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--alert-terracotta)' }}
          >
            Tap to Calibrate Now →
          </div>
        </div>
      </Link>
    )
  }

  /* ── Calibrated — calm matcha badge ─────────────────────────────────── */
  return (
    <div
      className="rounded-2xl px-4 py-3 flex items-center justify-between card-interactive"
      style={{ backgroundColor: 'var(--accent-matcha)' }}
    >
      <div>
        <p className="text-sm font-semibold text-white">Calibrated ✓</p>
        {lastCalibration && (
          <p className="text-xs text-white/80">Last at {formatTime(lastCalibration)}</p>
        )}
      </div>
      <span className="text-2xl text-white/80">✓</span>
    </div>
  )
}
