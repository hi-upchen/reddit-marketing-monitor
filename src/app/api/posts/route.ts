import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const denied = await requireAuth(); if (denied) return denied
  const { searchParams } = new URL(req.url)
  const productId = searchParams.get('productId')
  const tier = searchParams.get('tier')
  const status = searchParams.get('status') ?? 'new,draft,approved,bookmarked'
  const statuses = status.split(',').filter(Boolean)

  const conditions: string[] = []
  const values: (string | number)[] = []

  if (productId) { conditions.push('rp.product_id = ?'); values.push(productId) }
  if (tier) { conditions.push('rp.relevance_tier = ?'); values.push(tier) }
  if (statuses.length) {
    conditions.push(`rp.status IN (${statuses.map(() => '?').join(',')})`)
    values.push(...statuses)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await query<{
    id: string; reddit_post_id: string; product_id: string; subreddit: string
    title: string; body: string; author: string; score: number
    comment_count: number; url: string; matched_keywords: string
    relevance_score: number; relevance_tier: string; relevance_reason: string
    status: string; reddit_created_at: string; fetched_at: string
    product_id2: string; product_name: string
  }>(
    `SELECT rp.*, p.id as product_id2, p.name as product_name
     FROM reddit_posts rp
     LEFT JOIN products p ON rp.product_id = p.id
     ${where}
     ORDER BY rp.relevance_score DESC, rp.fetched_at DESC
     LIMIT 100`,
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
      product: r.product_id2 ? { id: r.product_id2, name: r.product_name } : null,
    }
  }))
}
