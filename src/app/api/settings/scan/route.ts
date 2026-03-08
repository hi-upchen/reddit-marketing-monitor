import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { appSettings, scanLogs } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'

const SCAN_KEY = 'scan_settings'

export const DEFAULT_SCAN_SETTINGS = {
  intervalHours: 3,   // 1 | 3 | 6 | 12 | 24
  daysBack: 7,        // 1 | 3 | 7 | 30
}

export async function GET() {
  const [settingsRow] = await db.select().from(appSettings).where(eq(appSettings.key, SCAN_KEY))
  const settings = settingsRow
    ? { ...DEFAULT_SCAN_SETTINGS, ...JSON.parse(settingsRow.value) }
    : DEFAULT_SCAN_SETTINGS

  // Also return last scan info
  const [lastScan] = await db
    .select()
    .from(scanLogs)
    .where(eq(scanLogs.status, 'completed'))
    .orderBy(desc(scanLogs.completedAt))
    .limit(1)

  return NextResponse.json({
    ...settings,
    lastScanAt: lastScan?.completedAt ?? null,
    lastScanNew: lastScan?.newPosts ?? null,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const VALID_INTERVALS = [1, 3, 6, 12, 24]
  const VALID_DAYS = [1, 3, 7, 30]

  if (body.intervalHours && !VALID_INTERVALS.includes(Number(body.intervalHours))) {
    return NextResponse.json({ error: 'intervalHours must be 1, 3, 6, 12, or 24' }, { status: 400 })
  }
  if (body.daysBack && !VALID_DAYS.includes(Number(body.daysBack))) {
    return NextResponse.json({ error: 'daysBack must be 1, 3, 7, or 30' }, { status: 400 })
  }

  const merged = { ...DEFAULT_SCAN_SETTINGS, ...body }
  await db
    .insert(appSettings)
    .values({ key: SCAN_KEY, value: JSON.stringify(merged) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(merged), updatedAt: new Date().toISOString() },
    })
  return NextResponse.json({ ok: true })
}
