import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { exchangeCodeForToken, saveToken } from '@/lib/reddit-auth'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const denied = await requireAuth(); if (denied) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const storedState = req.cookies.get('reddit_oauth_state')?.value

  if (!code || !state || !storedState || state.length !== storedState.length) {
    return NextResponse.redirect(new URL('/settings/reddit?error=oauth_failed', req.url))
  }

  // Constant-time comparison for OAuth state to prevent timing attacks
  const stateMatch = timingSafeEqual(Buffer.from(state), Buffer.from(storedState))
  if (!stateMatch) {
    return NextResponse.redirect(new URL('/settings/reddit?error=oauth_failed', req.url))
  }

  try {
    const tokenData = await exchangeCodeForToken(code)
    await saveToken(tokenData)
    return NextResponse.redirect(new URL('/settings/reddit?connected=true', req.url))
  } catch (e) {
    console.error('Reddit OAuth callback error:', e)
    return NextResponse.redirect(new URL('/settings/reddit?error=token_exchange_failed', req.url))
  }
}
