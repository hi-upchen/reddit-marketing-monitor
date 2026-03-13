import { NextResponse } from 'next/server'
import { deleteToken } from '@/lib/reddit-auth'
import { requireAuth } from '@/lib/auth'

export async function POST() {
  const denied = await requireAuth(); if (denied) return denied
  await deleteToken()
  return NextResponse.json({ ok: true })
}
