import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied
  const { id } = await params
  const { draftId, body } = await req.json()

  if (!draftId) return NextResponse.json({ error: 'draftId is required' }, { status: 400 })
  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return NextResponse.json({ error: 'Reply body cannot be empty' }, { status: 400 })
  }

  // IDOR guard: verify the draft belongs to this post before updating
  const draftCheck = await query<{ id: string }>(
    'SELECT id FROM reply_drafts WHERE id = ? AND post_id = ?',
    [draftId, id]
  )
  if (!draftCheck.length) {
    return NextResponse.json({ error: 'Draft not found or does not belong to this post' }, { status: 404 })
  }

  const { rowsAffected } = await execute(
    `UPDATE reply_drafts SET body = ?, is_approved = 1, approved_at = ? WHERE id = ?`,
    [body, new Date().toISOString(), draftId]
  )
  if (!rowsAffected) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  await execute(`UPDATE reddit_posts SET status = 'approved' WHERE id = ?`, [id])
  return NextResponse.json({ ok: true })
}
