import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { appSettings } from '@/db/schema'
import { eq } from 'drizzle-orm'

const NOTIF_KEY = 'notification_settings'

export const DEFAULT_NOTIF_SETTINGS = {
  email: process.env.NOTIFICATION_EMAIL ?? '',
  threshold: 'high',        // 'high' | 'high,medium' | 'all'
  frequency: 'digest',      // 'digest' | 'immediate'
  quietStart: '23:00',
  quietEnd: '08:00',
  telegramEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
}

export async function GET() {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, NOTIF_KEY))
  const settings = rows.length
    ? { ...DEFAULT_NOTIF_SETTINGS, ...JSON.parse(rows[0].value) }
    : DEFAULT_NOTIF_SETTINGS
  return NextResponse.json(settings)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const merged = { ...DEFAULT_NOTIF_SETTINGS, ...body }
  await db
    .insert(appSettings)
    .values({ key: NOTIF_KEY, value: JSON.stringify(merged) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(merged), updatedAt: new Date().toISOString() },
    })
  return NextResponse.json({ ok: true })
}
