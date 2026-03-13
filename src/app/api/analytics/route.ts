import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const denied = await requireAuth(); if (denied) return denied
  const { searchParams } = new URL(req.url)
  const productId = searchParams.get('productId')
  const VALID_DAYS = [7, 14, 30, 60, 90]
  const rawDays = parseInt(searchParams.get('days') ?? '30')
  const days = VALID_DAYS.includes(rawDays) ? rawDays : 30
  const since = new Date(Date.now() - days * 86400_000).toISOString()

  const conditions: string[] = ['fetched_at >= ?']
  const values: (string | number)[] = [since]
  if (productId) { conditions.push('product_id = ?'); values.push(productId) }
  const where = `WHERE ${conditions.join(' AND ')}`

  const [byTier, bySubreddit, totalRows, replyRateRows, keywordRows] = await Promise.all([
    query<{ relevance_tier: string; count: number }>(
      `SELECT relevance_tier, COUNT(*) as count FROM reddit_posts ${where} GROUP BY relevance_tier`, values
    ),
    query<{ subreddit: string; count: number }>(
      `SELECT subreddit, COUNT(*) as count FROM reddit_posts ${where} GROUP BY subreddit ORDER BY count DESC LIMIT 10`, values
    ),
    query<{ count: number }>(`SELECT COUNT(*) as count FROM reddit_posts ${where}`, values),
    query<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM reddit_posts ${where} AND relevance_tier = 'high' GROUP BY status`,
      values
    ),
    query<{ matched_keywords: string }>(`SELECT matched_keywords FROM reddit_posts ${where}`, values),
  ])

  const keywordCounts: Record<string, number> = {}
  for (const row of keywordRows) {
    let kws: string[] = []
    try { kws = JSON.parse(row.matched_keywords) ?? [] } catch { /* malformed — skip row */ }
    for (const kw of kws) {
      keywordCounts[kw] = (keywordCounts[kw] ?? 0) + 1
    }
  }
  const byKeyword = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }))

  const totalHigh = replyRateRows.reduce((a, r) => a + r.count, 0)
  const posted = replyRateRows.find(r => r.status === 'posted')?.count ?? 0

  return NextResponse.json({
    total: totalRows[0]?.count ?? 0,
    byTier,
    bySubreddit,
    byKeyword,
    replyRate: totalHigh > 0 ? Math.round((posted / totalHigh) * 100) : 0,
    posted,
    totalHigh,
    days,
  })
}
