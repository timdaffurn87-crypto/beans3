import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * POST /api/eod-email
 * Sends the EOD report summary to the owner's email address.
 * Attaches the Xero Bill Import CSV if provided.
 * Uses Resend if RESEND_API_KEY env var is set; falls back to console log.
 */
export async function POST(request: Request) {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { xero_csv, xero_csv_filename, ...report } = body

  // Get owner email from settings
  const { data: emailSetting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'owner_email')
    .single()

  const ownerEmail = emailSetting?.value
  if (!ownerEmail) {
    console.log('EOD Report (no owner email configured):', JSON.stringify(report, null, 2))
    return NextResponse.json({ success: true, note: 'No owner email configured' })
  }

  const html = buildEODEmailHTML(report)
  const subject = `Beans EOD Report — ${report.cafe_day}`

  const resendKey = process.env.RESEND_API_KEY
  if (resendKey) {
    try {
      // Build email payload — attach CSV if we have one with line items
      // Resend expects attachments as base64-encoded content
      const emailPayload: Record<string, unknown> = {
        from: 'Beans <onboarding@resend.dev>',
        to: ownerEmail,
        subject,
        html,
      }

      if (xero_csv && xero_csv_filename) {
        const csvBase64 = Buffer.from(xero_csv, 'utf-8').toString('base64')
        emailPayload.attachments = [
          {
            filename: xero_csv_filename,
            content: csvBase64,
          },
        ]
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailPayload),
      })

      if (!res.ok) {
        const err = await res.json()
        console.error('Resend error:', err)
        return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    } catch (err) {
      console.error('Email send error:', err)
      return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
    }
  }

  // Fallback: log to console (no Resend key configured)
  console.log(`EOD Report Email to ${ownerEmail}:`)
  console.log(subject)
  console.log(JSON.stringify(report, null, 2))
  if (xero_csv) console.log(`Xero CSV attachment (${xero_csv_filename}):\n${xero_csv}`)
  return NextResponse.json({
    success: true,
    note: 'Logged to console. Set RESEND_API_KEY env var to send real emails.',
  })
}

/** Builds a clean HTML email body for the EOD report */
function buildEODEmailHTML(report: {
  cafe_day: string
  tasks_completed: number
  tasks_total: number
  waste_total_value: number
  waste_top_items: { item_name: string; total_cost: number; quantity: number }[]
  calibration_count: number
  calibration_compliance_pct: number
  invoices_count: number
  invoices_total_value: number
  notes: string | null
  submitted_by: string
}): string {
  const taskPct =
    report.tasks_total > 0
      ? Math.round((report.tasks_completed / report.tasks_total) * 100)
      : 0

  const topItems = Array.isArray(report.waste_top_items) ? report.waste_top_items : []

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Beans EOD Report</title></head>
<body style="font-family: sans-serif; background: #FAF8F3; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; padding: 32px;">
    <h1 style="color: #1A1A1A; font-size: 24px; margin: 0 0 4px;">Beans — End of Day</h1>
    <p style="color: #888; margin: 0 0 24px;">${report.cafe_day}</p>

    <table width="100%" cellpadding="12" style="border-collapse: collapse; margin-bottom: 24px;">
      <tr>
        <td style="background: #f9f9f7; border-radius: 8px; width: 50%;">
          <div style="font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Tasks</div>
          <div style="font-size: 22px; font-weight: bold; color: #1A1A1A;">${report.tasks_completed}/${report.tasks_total}</div>
          <div style="font-size: 13px; color: #888;">${taskPct}% complete</div>
        </td>
        <td style="width: 8px;"></td>
        <td style="background: #f9f9f7; border-radius: 8px; width: 50%;">
          <div style="font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Waste</div>
          <div style="font-size: 22px; font-weight: bold; color: #1A1A1A;">$${report.waste_total_value.toFixed(2)}</div>
          <div style="font-size: 13px; color: #888;">total waste value</div>
        </td>
      </tr>
      <tr><td colspan="3" style="height: 8px;"></td></tr>
      <tr>
        <td style="background: #f9f9f7; border-radius: 8px;">
          <div style="font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Calibration</div>
          <div style="font-size: 22px; font-weight: bold; color: #1A1A1A;">${report.calibration_compliance_pct}%</div>
          <div style="font-size: 13px; color: #888;">${report.calibration_count} calibrations</div>
        </td>
        <td style="width: 8px;"></td>
        <td style="background: #f9f9f7; border-radius: 8px;">
          <div style="font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Invoices</div>
          <div style="font-size: 22px; font-weight: bold; color: #1A1A1A;">${report.invoices_count}</div>
          <div style="font-size: 13px; color: #888;">$${report.invoices_total_value.toFixed(2)} ex-GST</div>
        </td>
      </tr>
    </table>

    ${topItems.length > 0 ? `
    <h3 style="color: #1A1A1A; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 12px;">Top Waste Items</h3>
    <ul style="margin: 0 0 24px; padding: 0; list-style: none;">
      ${topItems.map(item => `
        <li style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
          <span style="color: #1A1A1A;">${item.item_name} ×${item.quantity}</span>
          <span style="font-weight: bold; color: #DC2626;">$${item.total_cost.toFixed(2)}</span>
        </li>
      `).join('')}
    </ul>` : ''}

    ${report.notes ? `
    <h3 style="color: #1A1A1A; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 12px;">Notes</h3>
    <p style="color: #555; background: #f9f9f7; padding: 16px; border-radius: 8px; margin: 0 0 24px;">${report.notes}</p>
    ` : ''}

    <div style="background: #f0f7ff; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 13px; color: #1A6BB3; font-weight: 600;">📎 Xero Import Attached</p>
      <p style="margin: 4px 0 0; font-size: 12px; color: #555;">
        The Xero Bill Import CSV is attached to this email.<br>
        In Xero: Bills to Pay → Import → select the attached file.
      </p>
    </div>

    <p style="color: #aaa; font-size: 12px; margin: 0;">Sent by Beans · Cocoa Café Operations</p>
  </div>
</body>
</html>`
}
