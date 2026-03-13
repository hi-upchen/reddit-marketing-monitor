import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getPassword, createSession, SESSION_COOKIE } from '@/lib/auth'

// In-memory rate limiter: max 5 attempts per IP per minute
// Simple Map — resets on server restart, fine for a personal tool
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 60_000 // 1 minute

function getClientIp(req: NextRequest): string {
  // On Vercel/trusted reverse proxies, x-forwarded-for is set by the platform
  // and cannot be spoofed. In other environments, fall back to a global bucket
  // so the rate limiter can't be bypassed by spoofing headers.
  if (process.env.VERCEL) {
    return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'global'
  }
  // Self-hosted: don't trust client-provided headers; use a single global bucket.
  // This means all clients share the rate limit, but for a single-user personal
  // tool this is acceptable and prevents header-spoofing bypass.
  return 'global'
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(ip)

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }

  entry.count++
  if (entry.count > MAX_ATTEMPTS) return true
  return false
}

function recordSuccess(ip: string) {
  loginAttempts.delete(ip) // reset on success
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again in a minute.' },
      { status: 429 }
    )
  }

  let password: string
  try {
    const body = await req.json()
    password = body?.password ?? ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof password !== 'string' || !password) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  // Constant-time comparison — prevents timing attacks
  const expected = getPassword()
  const inputBuf = Buffer.alloc(expected.length)
  inputBuf.write(password.slice(0, expected.length))
  const expectedBuf = Buffer.from(expected)

  const match =
    password.length === expected.length &&
    timingSafeEqual(inputBuf, expectedBuf)

  if (!match) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  recordSuccess(ip)

  const sessionToken = await createSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
  return res
}
