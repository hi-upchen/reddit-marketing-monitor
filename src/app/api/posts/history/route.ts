import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const denied = await requireAuth(); if (denied) return denied
  const { searchParams } = new URL(req.url)
  const rawSearch = searchParams.get('q') ?? ''
  const search = rawSearch.slice(0, 200).replace(/[%_\\]/g, '\\$&') || null
  const status = searchParams.get('status')
  const productId = searchParams.get('productId')
  const subreddit = searchParams.get('subreddit')

  const conditions: string[] = []
  const values: (string | number)[] = []

  if (status) { conditions.push('rp.status = ?'); values.push(status) }
  if (productId) { conditions.push('rp.product_id = ?'); values.push(productId) }
  if (subreddit) { conditions.push('rp.subreddit = ?'); values.push(subreddit) }
  if (search) { conditions.push('rp.title LIKE ?'); values.push(`%${search}%`) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await query<{
    id: string; reddit_post_id: string; product_id: string; subreddit: string
    title: string; body: string; author: string; score: number; comment_count: number
    url: string; matched_keywords: string; relevance_score: number; relevance_tier: string
    relevance_reason: string; status: string; reddit_created_at: string; fetched_at: string
    p_id: string; p_name: string
  }>(
    `SELECT rp.*, p.id as p_id, p.name as p_name
     FROM reddit_posts rp LEFT JOIN products p ON rp.product_id = p.id
     ${where}
     ORDER BY rp.fetched_at DESC LIMIT 200`,
    values
  )

  return NextResponse.json(rows.map(r => {
    let matchedKeywords: string[] = []
    try { matchedKeywords = JSON.parse(r.matched_keywords) ?? [] } catch { /* malformed — skip */ }
    return {
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
    }
  }))
}
