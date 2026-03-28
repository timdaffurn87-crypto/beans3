/**
 * Supabase Edge Function: send-eod-email
 *
 * Triggered by a Supabase Database Webhook on INSERT to the `eod_reports` table.
 * Looks up the owner's email from the `settings` table, fetches the staff member's
 * name from `profiles`, and fetches till reconciliation data from `till_reconciliation`.
 * Sends a clean summary email via Resend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BEFORE DEPLOYING — MANUAL SETUP REQUIRED:
 *
 * 1. RESEND ACCOUNT
 *    Sign up at https://resend.com (free tier sends 3,000 emails/month).
 *    Create an API key from the Resend dashboard.
 *    Verify your sending domain (e.g. beans.cocoacafe.com.au) in Resend → Domains.
 *    If you don't have a custom domain yet, use "onboarding@resend.dev" as the from
 *    address during testing (Resend provides this for free accounts).
 *
 * 2. ADD RESEND_API_KEY AS A SUPABASE SECRET
 *    In your terminal (with Supabase CLI installed):
 *      supabase secrets set RESEND_API_KEY=re_your_key_here
 *    Or in Supabase Dashboard → Settings → Edge Functions → Add secret.
 *    Note: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
 *    by Supabase — you do NOT need to set those manually.
 *
 * 3. DEPLOY THE FUNCTION
 *    supabase functions deploy send-eod-email
 *
 * 4. SET UP THE DATABASE WEBHOOK (in Supabase Dashboard)
 *    Go to: Database → Webhooks → Create a new webhook
 *      - Name: eod-email-trigger
 *      - Table: eod_reports
 *      - Events: INSERT only
 *      - Type: Supabase Edge Functions
 *      - Edge Function: send-eod-email
 *    Save. From now on, every new EOD report insert fires this function automatically.
 *
 * 5. TEST IT
 *    Submit an EOD report from the app (or insert a row manually in the SQL Editor).
 *    Check: Supabase Dashboard → Edge Functions → send-eod-email → Logs
 *    You should see "Email sent successfully" in the logs and an email in your inbox.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of the eod_reports row delivered by the webhook */
interface EODRecord {
  id: string
  submitted_by: string
  cafe_day: string
  tasks_completed: number
  tasks_total: number
  waste_total_value: number
  waste_top_items: { item_name: string; total_cost: number; quantity: number }[]
  calibration_count: number
  calibration_compliance_pct: number
  calibration_gaps: { gap_start: string; gap_end: string; duration_minutes: number }[] | null
  invoices_count: number
  invoices_total_value: number
  notes: string | null
  created_at: string
}

/** Shape of the database webhook payload Supabase sends on INSERT */
interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  record: EODRecord
  old_record: null | EODRecord
}

/** Till reconciliation row from the till_reconciliation table */
interface TillRow {
  balanced: boolean
  discrepancy_amount: number | null
  explanation: string | null
  logged_at: string
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  try {
    // Only accept POST requests from the webhook
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const payload: WebhookPayload = await req.json()

    // Ignore anything that isn't an INSERT — we only email on new EOD reports
    if (payload.type !== 'INSERT') {
      return new Response('Ignored — not an INSERT', { status: 200 })
    }

    const report = payload.record

    // Build a Supabase client using the service role key so we can bypass RLS
    // and read sensitive settings (owner_email) and cross-table data
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // ── 1. Get owner email from settings ──────────────────────────────────────
    const { data: emailSetting, error: emailErr } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'owner_email')
      .single()

    if (emailErr || !emailSetting?.value) {
      console.error('No owner_email in settings — cannot send EOD email')
      return new Response('No owner email configured', { status: 200 })
    }

    const ownerEmail = emailSetting.value

    // ── 2. Get staff member's name ────────────────────────────────────────────
    const { data: staffProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', report.submitted_by)
      .single()

    const staffName = staffProfile?.full_name ?? 'Unknown staff'

    // ── 3. Get till reconciliation data for this café day ─────────────────────
    const { data: tillRow } = await supabase
      .from('till_reconciliation')
      .select('balanced, discrepancy_amount, explanation, logged_at')
      .eq('cafe_day', report.cafe_day)
      .single<TillRow>()

    // ── 4. Build and send the email ───────────────────────────────────────────
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.error('RESEND_API_KEY secret is not set — cannot send email')
      return new Response('RESEND_API_KEY not configured', { status: 500 })
    }

    const subject = `Cocoa Café – EOD Summary ${formatDate(report.cafe_day)}`
    const html = buildEmailHTML(report, staffName, tillRow ?? null)

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Update this from address once your domain is verified in Resend.
        // During testing with a free Resend account, use: onboarding@resend.dev
        from: 'Beans – Cocoa Café <beans@beans.cocoacafe.com.au>',
        to: ownerEmail,
        subject,
        html,
      }),
    })

    if (!resendResponse.ok) {
      const err = await resendResponse.json()
      console.error('Resend API error:', JSON.stringify(err))
      return new Response('Email send failed', { status: 500 })
    }

    console.log(`Email sent successfully to ${ownerEmail} for café day ${report.cafe_day}`)
    return new Response('OK', { status: 200 })

  } catch (err) {
    console.error('Unexpected error in send-eod-email:', err)
    return new Response('Internal server error', { status: 500 })
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a YYYY-MM-DD date string as a readable Australian date e.g. "Saturday 28 March 2026"
 */
function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Formats a timestamptz string to a short time string in AEST e.g. "2:34 PM"
 */
function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Builds the HTML email body for the EOD summary.
 * Includes all operational stats plus till reconciliation result.
 */
function buildEmailHTML(
  report: EODRecord,
  staffName: string,
  till: TillRow | null
): string {
  const taskPct =
    report.tasks_total > 0
      ? Math.round((report.tasks_completed / report.tasks_total) * 100)
      : 0

  const topItems = Array.isArray(report.waste_top_items) ? report.waste_top_items : []

  // Till reconciliation section — green if balanced, red if not, grey if not recorded
  const tillHTML = (() => {
    if (!till) {
      return `
      <div style="background:#f9f9f7; border-radius:8px; padding:16px; margin-bottom:16px;">
        <div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">Till Reconciliation</div>
        <div style="font-size:15px; color:#888;">Not recorded</div>
      </div>`
    }

    if (till.balanced) {
      return `
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:16px; margin-bottom:16px;">
        <div style="font-size:11px; color:#16A34A; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">Till Reconciliation</div>
        <div style="font-size:18px; font-weight:bold; color:#16A34A;">✓ Balanced</div>
        <div style="font-size:12px; color:#555; margin-top:4px;">Logged at ${formatTime(till.logged_at)}</div>
      </div>`
    }

    return `
    <div style="background:#fef2f2; border:2px solid #fca5a5; border-radius:8px; padding:16px; margin-bottom:16px;">
      <div style="font-size:11px; color:#DC2626; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">Till Reconciliation</div>
      <div style="font-size:18px; font-weight:bold; color:#DC2626;">✗ Did Not Balance</div>
      ${till.discrepancy_amount != null ? `<div style="font-size:14px; font-weight:600; color:#1A1A1A; margin-top:8px;">Discrepancy: $${Math.abs(till.discrepancy_amount).toFixed(2)} ${till.discrepancy_amount < 0 ? 'under' : 'over'}</div>` : ''}
      ${till.explanation ? `<div style="font-size:13px; color:#555; margin-top:6px; background:white; padding:10px; border-radius:6px;">${till.explanation}</div>` : ''}
      <div style="font-size:12px; color:#999; margin-top:6px;">Logged at ${formatTime(till.logged_at)}</div>
    </div>`
  })()

  // Calibration gap warnings — shown if any gaps were detected
  const gapsHTML = (() => {
    if (!report.calibration_gaps || report.calibration_gaps.length === 0) return ''
    return `
    <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:12px; margin-bottom:16px;">
      <div style="font-size:11px; color:#D97706; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Calibration Gaps Detected</div>
      ${report.calibration_gaps.map(gap => `
        <div style="font-size:13px; color:#555; margin-bottom:4px;">
          ${formatTime(gap.gap_start)} → ${formatTime(gap.gap_end)}
          <span style="color:#D97706; font-weight:600;"> (${gap.duration_minutes} min)</span>
        </div>
      `).join('')}
    </div>`
  })()

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cocoa Café – EOD Summary</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#FAF8F3; margin:0; padding:20px;">
  <div style="max-width:600px; margin:0 auto; background:white; border-radius:16px; padding:32px; box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <div style="font-size:11px; color:#B8960C; text-transform:uppercase; letter-spacing:2px; font-weight:600; margin-bottom:4px;">Cocoa Café</div>
      <h1 style="color:#1A1A1A; font-size:22px; margin:0 0 4px; font-weight:700;">End of Day Summary</h1>
      <p style="color:#888; margin:0; font-size:14px;">${formatDate(report.cafe_day)}</p>
      <p style="color:#888; margin:4px 0 0; font-size:13px;">Closed by <strong style="color:#1A1A1A;">${staffName}</strong> at ${formatTime(report.created_at)}</p>
    </div>

    <!-- Till Reconciliation — shown first as it's the most operationally critical -->
    ${tillHTML}

    <!-- Stats grid -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        <td style="width:48%; background:#f9f9f7; border-radius:10px; padding:14px; vertical-align:top;">
          <div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Tasks</div>
          <div style="font-size:24px; font-weight:700; color:#1A1A1A; line-height:1;">${report.tasks_completed}/${report.tasks_total}</div>
          <div style="font-size:13px; color:${taskPct >= 90 ? '#16A34A' : taskPct >= 70 ? '#D97706' : '#DC2626'}; font-weight:600; margin-top:4px;">${taskPct}% complete</div>
        </td>
        <td style="width:4%;"></td>
        <td style="width:48%; background:#f9f9f7; border-radius:10px; padding:14px; vertical-align:top;">
          <div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Waste</div>
          <div style="font-size:24px; font-weight:700; color:#1A1A1A; line-height:1;">$${report.waste_total_value.toFixed(2)}</div>
          <div style="font-size:13px; color:#888; margin-top:4px;">total value</div>
        </td>
      </tr>
      <tr><td colspan="3" style="height:8px;"></td></tr>
      <tr>
        <td style="width:48%; background:#f9f9f7; border-radius:10px; padding:14px; vertical-align:top;">
          <div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Calibration</div>
          <div style="font-size:24px; font-weight:700; color:#1A1A1A; line-height:1;">${report.calibration_compliance_pct}%</div>
          <div style="font-size:13px; color:#888; margin-top:4px;">${report.calibration_count} logged</div>
        </td>
        <td style="width:4%;"></td>
        <td style="width:48%; background:#f9f9f7; border-radius:10px; padding:14px; vertical-align:top;">
          <div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Invoices</div>
          <div style="font-size:24px; font-weight:700; color:#1A1A1A; line-height:1;">${report.invoices_count}</div>
          <div style="font-size:13px; color:#888; margin-top:4px;">$${report.invoices_total_value.toFixed(2)} ex-GST</div>
        </td>
      </tr>
    </table>

    <!-- Calibration gaps -->
    ${gapsHTML}

    <!-- Top waste items -->
    ${topItems.length > 0 ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px; font-weight:600;">Top Waste Items</div>
      ${topItems.map((item, i) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #f0ede8;">
          <div>
            <span style="font-size:13px; color:#888; margin-right:6px;">${i + 1}.</span>
            <span style="font-size:14px; color:#1A1A1A;">${item.item_name}</span>
            <span style="font-size:13px; color:#888;"> ×${item.quantity}</span>
          </div>
          <span style="font-size:14px; font-weight:700; color:#DC2626;">$${item.total_cost.toFixed(2)}</span>
        </div>
      `).join('')}
    </div>` : ''}

    <!-- Staff notes -->
    ${report.notes ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; font-weight:600;">Staff Notes</div>
      <div style="background:#f9f9f7; border-radius:8px; padding:14px; font-size:14px; color:#444; line-height:1.5;">${report.notes}</div>
    </div>` : ''}

    <!-- Footer -->
    <div style="border-top:1px solid #f0ede8; padding-top:16px; margin-top:8px;">
      <p style="margin:0; font-size:12px; color:#aaa;">
        Sent automatically by Beans · Cocoa Café Operations<br>
        Report ID: ${report.id}
      </p>
    </div>

  </div>
</body>
</html>`
}
