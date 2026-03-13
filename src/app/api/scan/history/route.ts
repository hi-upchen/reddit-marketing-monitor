import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  const denied = await requireAuth(); if (denied) return denied
  const logs = await query(
    'SELECT * FROM scan_logs ORDER BY started_at DESC LIMIT 50'
  )
  return NextResponse.json(logs)
}
