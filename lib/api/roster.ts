/**
 * lib/api/roster.ts
 *
 * Utility for calling the external Firebase HTTP Callable function
 * `getStaffRoster` (hosted in the "Milk" Firebase backend).
 *
 * Firebase callable function wire format:
 *   Request body:  { "data": { ...payload } }
 *   Response body: { "result": <returnValue> }
 *
 * Required env var:
 *   NEXT_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL
 *   e.g. "https://us-central1-milk-project-id.cloudfunctions.net"
 */

/** A single rostered shift returned by the Firebase backend */
export interface Shift {
  id: string
  /** ISO date string — e.g. "2026-03-29" */
  date: string
  /** 24-hour time string — e.g. "07:00" */
  start_time: string
  /** 24-hour time string — e.g. "15:00" */
  end_time: string
  /** Human-readable role label — e.g. "Barista", "Floor", "Supervisor" */
  role: string
}

/** Shape of the raw Firebase callable response */
interface FirebaseCallableResponse<T> {
  result: T
}

/**
 * Fetches the upcoming roster for a staff member from the Milk Firebase backend.
 *
 * Calls the `getStaffRoster` HTTP Callable function with the Beans staff ID
 * so the Firebase backend can look up the correct roster record.
 *
 * @param beansStaffId - The authenticated user's `profile.id` from Supabase (UUID)
 * @returns Ordered array of upcoming shifts — empty array if none scheduled
 * @throws Error if the network request fails or the URL env var is missing
 */
export async function getStaffRoster(beansStaffId: string): Promise<Shift[]> {
  const baseUrl = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL

  if (!baseUrl) {
    throw new Error(
      'Roster is not configured. Contact your manager. ' +
      '(Missing: NEXT_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL)'
    )
  }

  const url = `${baseUrl}/getStaffRoster`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    // Firebase callable functions expect the payload wrapped in { data: ... }
    body: JSON.stringify({
      data: { beans_staff_id: beansStaffId },
    }),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Failed to load roster: ${errorText}`)
  }

  const json: FirebaseCallableResponse<Shift[]> = await res.json()

  // Guard against unexpected shapes from the backend
  return Array.isArray(json.result) ? json.result : []
}

// ─── Date / time helpers (used by the UI layer) ──────────────────────────────

/**
 * Formats an ISO date string ("2026-03-29") into display parts.
 * Uses the en-AU locale and AEST-safe local parsing.
 */
export function formatShiftDate(dateStr: string): { dayName: string; displayDate: string } {
  // Append T00:00:00 to parse as local midnight, avoiding UTC offset flips
  const d = new Date(`${dateStr}T00:00:00`)
  const dayName = d.toLocaleDateString('en-AU', { weekday: 'long' })
  const displayDate = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return { dayName, displayDate }
}

/**
 * Calculates total shift duration in hours (decimal) from 24h time strings.
 * Returns a formatted label: "8 hrs", "4.5 hrs", etc.
 */
export function formatShiftDuration(startTime: string, endTime: string): string {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + (m ?? 0)
  }
  const totalMins = toMinutes(endTime) - toMinutes(startTime)
  if (totalMins <= 0) return '—'
  const hours = totalMins / 60
  // Show decimal only when needed (e.g. 4.5 hrs, not 8.0 hrs)
  const formatted = hours % 1 === 0 ? hours.toString() : hours.toFixed(1)
  return `${formatted} hrs`
}

/**
 * Converts a 24h time string ("07:30") to a 12h display format ("7:30 AM").
 */
export function format12h(time: string): string {
  const [hStr, mStr] = time.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${suffix}`
}
