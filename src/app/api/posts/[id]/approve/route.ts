import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { redditPosts, replyDrafts } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { draftId, body } = await req.json()

  if (!draftId) return NextResponse.json({ error: 'draftId is required' }, { status: 400 })
  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return NextResponse.json({ error: 'Reply body cannot be empty' }, { status: 400 })
  }

  const [updatedDraft] = await db
    .update(replyDrafts)
    .set({
      body,
      isApproved: true,
      approvedAt: new Date().toISOString(),
    })
    .where(eq(replyDrafts.id, draftId))
    .returning()

  if (!updatedDraft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  await db
    .update(redditPosts)
    .set({ status: 'approved' })
    .where(eq(redditPosts.id, id))

  return NextResponse.json({ ok: true })
}
