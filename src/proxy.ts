import { NextRequest, NextResponse } from 'next/server'

export const SESSION_COOKIE = 'rmm_session'
const SESSION_TOKEN_LENGTH = 64 // 32 random bytes → 64 hex chars
const HEX_RE = /^[0-9a-f]+$/

/**
 * Routes that don't need authentication.
 * Everything else (pages + API) requires a valid session.
 */
const PUBLIC_PATHS: (string | RegExp)[] = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  // OAuth callback now requires session auth via requireAuth()
  '/api/cron/scan',            // has its own CRON_SECRET auth
  /^\/_next\//,
  /^\/favicon/,
]

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(p =>
    typeof p === 'string' ? pathname === p || pathname.startsWith(p + '/') : p.test(pathname)
  )
}

/**
 * Middleware runs in Edge Runtime so cannot access the DB.
 * It does a fast format check (64 hex chars) to reject obviously invalid tokens.
 * Full DB validation happens in isAuthenticated() called by API routes.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (isPublic(pathname)) return NextResponse.next()

  const password = process.env.APP_PASSWORD
  if (!password) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Server misconfiguration: APP_PASSWORD not set' }, { status: 500 })
    }
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const hasValidFormat = typeof token === 'string'
    && token.length === SESSION_TOKEN_LENGTH
    && HEX_RE.test(token)

  if (!hasValidFormat) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Token has valid format — let through. API routes call isAuthenticated()
  // for full DB validation. Page routes are client-side and make API calls
  // which will be DB-validated.
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
