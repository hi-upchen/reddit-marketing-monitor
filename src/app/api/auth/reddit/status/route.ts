import { NextResponse } from 'next/server'
import { getToken } from '@/lib/reddit-auth'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  const denied = await requireAuth(); if (denied) return denied
  const token = await getToken()
  return NextResponse.json({
    connected: !!token,
    username: token?.username ?? null,
  })
}
