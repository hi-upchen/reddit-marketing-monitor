import { NextResponse } from 'next/server'
import { runScan } from '@/lib/scanner'
import { requireAuth } from '@/lib/auth'

export async function POST() {
  const denied = await requireAuth(); if (denied) return denied
  // Fire-and-forget: start the scan in background, return immediately
  // The scan takes 5-10 minutes — we can't hold the HTTP connection that long
  runScan('manual').catch((e: unknown) => {
    console.error('[scan] Background scan failed:', e instanceof Error ? e.message : e)
  })

  return NextResponse.json({ status: 'started' })
}
