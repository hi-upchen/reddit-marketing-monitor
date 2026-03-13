import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, revokeSession } from '@/lib/auth'

export async function POST() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await revokeSession(token)
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}
