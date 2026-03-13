import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

const SCAN_KEY = 'scan_settings'

export const DEFAULT_SCAN_SETTINGS = {
  intervalHours: 3,
  daysBack: 7,
}

export async function GET() {
  const denied = await requireAuth(); if (denied) return denied
  const rows = await query<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [SCAN_KEY])
  const settings = rows.length
    ? { ...DEFAULT_SCAN_SETTINGS, ...JSON.parse(rows[0].value) }
    : DEFAULT_SCAN_SETTINGS

  const lastScans = await query<{ completed_at: string; new_posts: number }>(
    `SELECT completed_at, new_posts FROM scan_logs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`
  )
  const lastScan = lastScans[0] ?? null

  return NextResponse.json({
    ...settings,
    lastScanAt: lastScan?.completed_at ?? null,
    lastScanNew: lastScan?.new_posts ?? null,
  })
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth(); if (denied) return denied
  const body = await req.json()
  const VALID_INTERVALS = [1, 3, 6, 12, 24]
  const VALID_DAYS = [1, 3, 7, 30]

  if (body.intervalHours && !VALID_INTERVALS.includes(Number(body.intervalHours))) {
    return NextResponse.json({ error: 'intervalHours must be 1, 3, 6, 12, or 24' }, { status: 400 })
  }
  if (body.daysBack && !VALID_DAYS.includes(Number(body.daysBack))) {
    return NextResponse.json({ error: 'daysBack must be 1, 3, 7, or 30' }, { status: 400 })
  }

  // Only pick known keys to prevent arbitrary data injection
  const safe: Partial<typeof DEFAULT_SCAN_SETTINGS> = {}
  if (body.intervalHours !== undefined) safe.intervalHours = Number(body.intervalHours)
  if (body.daysBack !== undefined) safe.daysBack = Number(body.daysBack)
  const merged = { ...DEFAULT_SCAN_SETTINGS, ...safe }
  const id = crypto.randomUUID()
  await execute(
    `INSERT INTO app_settings (id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [id, SCAN_KEY, JSON.stringify(merged), new Date().toISOString()]
  )
  return NextResponse.json({ ok: true })
}
