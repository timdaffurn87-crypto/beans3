import { createClient } from './supabase'
import { getCurrentCafeDay } from './cafe-day'

/**
 * Logs an action to the activity_log table.
 * Call this after any significant user action.
 * Fails silently — never throws or breaks the main flow.
 */
export async function logActivity(
  staffId: string,
  actionType: string,
  description: string,
  amount?: number
): Promise<void> {
  try {
    const supabase = createClient()
    await supabase.from('activity_log').insert({
      staff_id: staffId,
      action_type: actionType,
      description,
      amount: amount ?? null,
      cafe_day: getCurrentCafeDay(),
    })
  } catch {
    // Silently fail — activity log is non-critical
  }
}
