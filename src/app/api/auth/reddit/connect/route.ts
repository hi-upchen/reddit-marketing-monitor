import { NextResponse } from 'next/server'
import { getRedditAuthUrl } from '@/lib/reddit-auth'
import { requireAuth } from '@/lib/auth'
import crypto from 'crypto'

export async function GET() {
  const denied = await requireAuth(); if (denied) return denied
  const state = crypto.randomBytes(16).toString('hex')
  const url = getRedditAuthUrl(state)
  const res = NextResponse.redirect(url)
  res.cookies.set('reddit_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 300,
  })
  return res
}
