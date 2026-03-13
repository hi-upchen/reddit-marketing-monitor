import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { getToken } from '@/lib/reddit-auth'
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied
  const { id } = await params
  const { draftId, body } = await req.json()

  if (!draftId) return NextResponse.json({ error: 'draftId is required' }, { status: 400 })
  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return NextResponse.json({ error: 'Reply body cannot be empty' }, { status: 400 })
  }

  // IDOR guard: verify the draft belongs to this post before posting
  const draftCheck = await query<{ id: string }>(
    'SELECT id FROM reply_drafts WHERE id = ? AND post_id = ?',
    [draftId, id]
  )
  if (!draftCheck.length) {
    return NextResponse.json({ error: 'Draft not found or does not belong to this post' }, { status: 404 })
  }

  const posts = await query<{ id: string; reddit_post_id: string; status: string }>(
    'SELECT id, reddit_post_id, status FROM reddit_posts WHERE id = ?', [id]
  )
  if (!posts.length) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  const post = posts[0]

  if (post.status === 'posted') {
    return NextResponse.json({ error: 'This post has already been replied to' }, { status: 409 })
  }

  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'Reddit not connected' }, { status: 401 })

  const res = await fetch('https://oauth.reddit.com/api/comment', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'RedditMarketingMonitor/1.0',
    },
    body: new URLSearchParams({
      api_type: 'json',
      text: body,
      thing_id: `t3_${post.reddit_post_id}`,
    }),
  })

  const data = await res.json()
  if (data.json?.errors?.length > 0) {
    console.error('[post] Reddit API error:', data.json.errors)
    return NextResponse.json({ error: 'Reddit API error' }, { status: 400 })
  }

  const comment = data.json?.data?.things?.[0]?.data
  const commentId = comment?.id ?? null
  const commentUrl = comment?.permalink ? `https://reddit.com${comment.permalink}` : null

  await execute(
    `UPDATE reply_drafts SET body = ?, is_approved = 1, is_posted = 1, approved_at = ?, posted_at = ?,
     reddit_comment_id = ?, reddit_comment_url = ? WHERE id = ?`,
    [body, new Date().toISOString(), new Date().toISOString(), commentId, commentUrl, draftId]
  )
  await execute(`UPDATE reddit_posts SET status = 'posted' WHERE id = ?`, [id])

  return NextResponse.json({ ok: true, commentUrl })
}
