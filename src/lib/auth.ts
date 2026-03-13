import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { randomBytes, timingSafeEqual } from 'crypto'
import { query, execute } from '@/lib/db'

export const SESSION_COOKIE = 'rmm_session'
const SESSION_TOKEN_LENGTH = 64 // 32 random bytes → 64 hex chars
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// Known-weak passwords to reject at startup
const WEAK_PASSWORDS = new Set([
  'admin123', 'password', 'password123', '123456', 'admin', 'changeme',
  'qwerty', 'letmein', 'welcome', 'monkey', 'dragon', 'master', 'test',
  'rmm', 'secret', 'reddit',
])

// Known-weak encryption keys to reject
const WEAK_KEYS = new Set([
  '12345678901234567890123456789012',
  '32-character-random-string-here!!',
  'your_encryption_key_here_32chars',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
])

export function getPassword(): string {
  const pw = process.env.APP_PASSWORD
  if (!pw) throw new Error('APP_PASSWORD env var not set')
  return pw
}

/**
 * Called at startup (instrumentation.ts) to catch misconfiguration early.
 * Logs warnings rather than crashing — the app can still start for first-run setup.
 */
export function validateStartupSecrets(): void {
  const pw = process.env.APP_PASSWORD
  const key = process.env.ENCRYPTION_KEY

  if (!pw || WEAK_PASSWORDS.has(pw.toLowerCase())) {
    console.error(
      '[security] ⚠️  APP_PASSWORD is missing or uses a known-weak value. ' +
      'Set a strong password in .env.local before exposing this app to any network.'
    )
  }

  if (!key || WEAK_KEYS.has(key) || /^(.)\1+$/.test(key)) {
    console.error(
      '[security] ⚠️  ENCRYPTION_KEY is missing or uses a weak/placeholder value. ' +
      'Run setup.sh to auto-generate a secure key.'
    )
  }
}

/**
 * Create a new random session token, store it in the DB with expiry.
 */
export async function createSession(): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const id = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString()
  await execute(
    `INSERT INTO sessions (id, token, expires_at) VALUES (?, ?, ?)`,
    [id, token, expiresAt]
  )
  return token
}

/**
 * Validate a session token against the DB. Constant-time comparison.
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value
    if (!token || token.length !== SESSION_TOKEN_LENGTH) return false

    const rows = await query<{ token: string; expires_at: string }>(
      `SELECT token, expires_at FROM sessions WHERE token = ? LIMIT 1`,
      [token]
    )
    if (!rows.length) return false

    const row = rows[0]
    if (new Date(row.expires_at) < new Date()) {
      // Expired — clean it up
      await execute(`DELETE FROM sessions WHERE token = ?`, [token])
      return false
    }

    return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(row.token, 'hex'))
  } catch {
    return false
  }
}

/**
 * Revoke a specific session token.
 */
export async function revokeSession(token: string): Promise<void> {
  await execute(`DELETE FROM sessions WHERE token = ?`, [token])
}

/**
 * Revoke all sessions (e.g. on password change).
 */
export async function revokeAllSessions(): Promise<void> {
  await execute(`DELETE FROM sessions`, [])
}

/**
 * Guard for API routes. Returns a 401 response if not authenticated, or null if OK.
 * Usage: const denied = await requireAuth(); if (denied) return denied;
 */
export async function requireAuth(): Promise<NextResponse | null> {
  const authed = await isAuthenticated()
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}
