// Café day helpers — always use these, never raw Date()
// The café day runs from the configured start time to end time (default 5:30 AM – 3:00 PM AEST)

// Default café day times
const DEFAULT_START = '05:30'

// Australian Eastern Time offset (+10 or +11 for DST — use a fixed offset approach)
// We'll use the 'Australia/Sydney' timezone via Intl.DateTimeFormat

/**
 * Returns the current time as a Date in Australian Eastern Time.
 * Uses Intl.DateTimeFormat.formatToParts for reliable cross-environment parsing
 * instead of new Date(toLocaleString()), which produces unparseable strings on some systems.
 */
export function getNowAEST(): Date {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const get = (type: string): number =>
    parseInt(parts.find(p => p.type === type)?.value ?? '0', 10)

  // Construct a plain Date using Sydney local time parts (no timezone shift applied)
  return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
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
