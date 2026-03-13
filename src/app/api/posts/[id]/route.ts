import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied
  const { id } = await params
  const rows = await query<{
    id: string; reddit_post_id: string; product_id: string; subreddit: string
    title: string; body: string; author: string; score: number; comment_count: number
    url: string; matched_keywords: string; relevance_score: number; relevance_tier: string
    relevance_reason: string; status: string; reddit_created_at: string; fetched_at: string
    p_id: string; p_name: string
  }>(
    `SELECT rp.*, p.id as p_id, p.name as p_name
     FROM reddit_posts rp LEFT JOIN products p ON rp.product_id = p.id
     WHERE rp.id = ?`,
    [id]
  )
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = rows[0]
  let matchedKeywords: string[] = []
  try { matchedKeywords = JSON.parse(r.matched_keywords) ?? [] } catch { /* malformed — skip */ }
  return NextResponse.json({
    post: {
      id: r.id, redditPostId: r.reddit_post_id, productId: r.product_id,
      subreddit: r.subreddit, title: r.title, body: r.body, author: r.author,
      score: r.score, commentCount: r.comment_count, url: r.url,
      matchedKeywords,
      relevanceScore: r.relevance_score, relevanceTier: r.relevance_tier,
      relevanceReason: r.relevance_reason, status: r.status,
      redditCreatedAt: r.reddit_created_at, fetchedAt: r.fetched_at,
    },
    product: r.p_id ? { id: r.p_id, name: r.p_name } : null,
  })
}

const ALLOWED_STATUS = ['new', 'draft', 'approved', 'posted', 'skipped', 'bookmarked']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied
  const { id } = await params
  const body = await req.json()

  if (body.status !== undefined) {
    if (!ALLOWED_STATUS.includes(body.status)) {
      return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 400 })
    }
    await execute('UPDATE reddit_posts SET status = ? WHERE id = ?', [body.status, id])
    const rows = await query<{ id: string; matched_keywords: string; status: string }>(
      'SELECT * FROM reddit_posts WHERE id = ?', [id]
    )
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    let kws: string[] = []
    try { kws = JSON.parse(rows[0].matched_keywords) ?? [] } catch { /* malformed — skip */ }
    return NextResponse.json({ ...rows[0], matchedKeywords: kws })
  }

  return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
}
