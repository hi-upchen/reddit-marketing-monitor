import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied
  const { id } = await params
  const { body } = await req.json().catch(() => ({ body: '' }))

  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return NextResponse.json({ error: 'Body is required' }, { status: 400 })
  }

  const posts = await query<{ id: string; product_id: string }>(
    'SELECT id, product_id FROM reddit_posts WHERE id = ?', [id]
  )
  if (!posts.length) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const existingDrafts = await query<{ version: number }>(
    'SELECT version FROM reply_drafts WHERE post_id = ? ORDER BY version DESC LIMIT 1', [id]
  )
  const version = (existingDrafts[0]?.version ?? 0) + 1

  const draftId = crypto.randomUUID()
  await execute(
    `INSERT INTO reply_drafts (id, post_id, product_id, body, version, variant) VALUES (?, ?, ?, ?, ?, 1)`,
    [draftId, id, posts[0].product_id, body.trim(), version]
  )

  return NextResponse.json({ id: draftId })
}
