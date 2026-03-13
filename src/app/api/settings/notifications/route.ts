import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

const NOTIF_KEY = 'notification_settings'

export const DEFAULT_NOTIF_SETTINGS = {
  email: process.env.NOTIFICATION_EMAIL ?? '',
  threshold: 'high',
  frequency: 'digest',
  quietStart: '23:00',
  quietEnd: '08:00',
}

export async function GET() {
  const denied = await requireAuth(); if (denied) return denied
  const rows = await query<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [NOTIF_KEY])
  const settings = rows.length
    ? { ...DEFAULT_NOTIF_SETTINGS, ...JSON.parse(rows[0].value) }
    : DEFAULT_NOTIF_SETTINGS
  return NextResponse.json(settings)
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth(); if (denied) return denied
  const body = await req.json()

  const VALID_THRESHOLDS = ['high', 'high,medium', 'all']
  const VALID_FREQUENCIES = ['digest', 'immediate']
  const TIME_RE = /^\d{2}:\d{2}$/
  const errors: string[] = []

  if (body.threshold !== undefined && !VALID_THRESHOLDS.includes(body.threshold)) errors.push('threshold must be one of: high, high,medium, all')
  if (body.frequency !== undefined && !VALID_FREQUENCIES.includes(body.frequency)) errors.push('frequency must be digest or immediate')
  if (body.quietStart !== undefined && !TIME_RE.test(body.quietStart)) errors.push('quietStart must be HH:MM format')
  if (body.quietEnd !== undefined && !TIME_RE.test(body.quietEnd)) errors.push('quietEnd must be HH:MM format')
  if (body.email !== undefined && typeof body.email !== 'string') errors.push('email must be a string')
  if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 })

  const ALLOWED = ['email', 'threshold', 'frequency', 'quietStart', 'quietEnd']
  const safe: Record<string, unknown> = {}
  for (const k of ALLOWED) { if (body[k] !== undefined) safe[k] = body[k] }

  const merged = { ...DEFAULT_NOTIF_SETTINGS, ...safe }
  const id = crypto.randomUUID()
  await execute(
    `INSERT INTO app_settings (id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [id, NOTIF_KEY, JSON.stringify(merged), new Date().toISOString()]
  )
  return NextResponse.json({ ok: true })
}
