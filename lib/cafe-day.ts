// Café day helpers — always use these, never raw Date()
// The café day runs from the configured start time to end time (default 5:30 AM – 3:00 PM AEST)

// Default café day times
const DEFAULT_START = '05:30'

// Australian Eastern Time offset (+10 or +11 for DST — use a fixed offset approach)
// We'll use the 'Australia/Sydney' timezone via Intl.DateTimeFormat

/** Returns the current time as a Date in Australian Eastern Time */
export function getNowAEST(): Date {
  return new Date(new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }))
}

/** Parses a time string like "05:30" into { hours, minutes } */
function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(':').map(Number)
  return { hours, minutes }
}

/**
 * Returns the current café day date as a YYYY-MM-DD string.
 * If current AEST time is before the café day start, return yesterday's date.
 * E.g. at 4 AM, we're still in "yesterday's" café day boundary (pre-open).
 * Actually, café day starts at 5:30 AM — anything before that is prior day.
 */
export function getCurrentCafeDay(cafeDayStart: string = DEFAULT_START): string {
  const nowAEST = getNowAEST()
  const { hours: startHour, minutes: startMin } = parseTime(cafeDayStart)

  const currentHour = nowAEST.getHours()
  const currentMin = nowAEST.getMinutes()

  // If before the café day start time, we're still in the previous day's context
  const beforeStart =
    currentHour < startHour || (currentHour === startHour && currentMin < startMin)

  if (beforeStart) {
    // Return yesterday's date
    const yesterday = new Date(nowAEST)
    yesterday.setDate(yesterday.getDate() - 1)
    return formatDate(yesterday)
  }

  return formatDate(nowAEST)
}

/** Formats a Date to YYYY-MM-DD */
export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Returns a greeting based on AEST time */
export function getGreeting(): string {
  const hour = getNowAEST().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}
