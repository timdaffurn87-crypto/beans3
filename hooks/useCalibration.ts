'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { getCurrentCafeDay } from '@/lib/cafe-day'

interface CalibrationState {
  lastCalibration: string | null  // ISO timestamp
  isOverdue: boolean
  loading: boolean
}

/** Returns the last calibration time and whether it's overdue (>60 min since last) */
export function useCalibration(): CalibrationState {
  const [lastCalibration, setLastCalibration] = useState<string | null>(null)
  const [isOverdue, setIsOverdue] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function fetchLastCalibration() {
      const cafeDay = getCurrentCafeDay()

      const { data } = await supabase
        .from('calibrations')
        .select('created_at')
        .eq('cafe_day', cafeDay)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (data) {
        const lastTime = new Date(data.created_at).getTime()
        const now = Date.now()
        const minutesSince = (now - lastTime) / 1000 / 60

        setLastCalibration(data.created_at)
        setIsOverdue(minutesSince > 60)
      } else {
        setLastCalibration(null)
        setIsOverdue(true)
      }

      setLoading(false)
    }

    fetchLastCalibration()

    // Re-check every minute
    const interval = setInterval(fetchLastCalibration, 60000)
    return () => clearInterval(interval)
  }, [])

  return { lastCalibration, isOverdue, loading }
}
