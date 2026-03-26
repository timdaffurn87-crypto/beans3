/** Formats a number as AUD currency: $12.50 */
export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/** Formats a date string for display: "Tuesday, Nov 12" */
export function formatDisplayDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-AU', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'Australia/Sydney',
  })
}

/** Formats a timestamp for display in AEST: "9:32 AM" */
export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Australia/Sydney',
  })
}

/** Calculates espresso ratio from dose and yield */
export function calculateRatio(dose: number, yield_: number): string {
  if (!dose || !yield_) return '—'
  return `1:${(yield_ / dose).toFixed(1)}`
}

/** Generates a random 4-digit PIN */
export function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString()
}

/** Clamps a number between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
