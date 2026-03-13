import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  const denied = await requireAuth(); if (denied) return denied
  const rows = await query<{
    id: string; name: string; url: string; description: string
    problems_solved: string; features: string; target_audience: string
    reply_tone: string; promotion_intensity: string; keywords: string
    subreddits: string; is_active: number; created_at: string
  }>('SELECT * FROM products ORDER BY created_at ASC')

  return NextResponse.json(rows.map(r => ({
    ...r,
    problemsSolved: r.problems_solved,
    targetAudience: r.target_audience,
    replyTone: r.reply_tone,
    promotionIntensity: r.promotion_intensity,
    isActive: r.is_active === 1,
    keywords: JSON.parse(r.keywords),
    subreddits: JSON.parse(r.subreddits),
  })))
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth(); if (denied) return denied
  const body = await req.json()

  const required = ['name', 'url', 'description', 'problemsSolved', 'features', 'targetAudience']
  for (const field of required) {
    if (!body[field] || typeof body[field] !== 'string' || !String(body[field]).trim()) {
      return NextResponse.json({ error: `${field} is required` }, { status: 400 })
    }
  }
  if (!/^https?:\/\/.+/.test(body.url)) {
    return NextResponse.json({ error: 'url must start with http:// or https://' }, { status: 400 })
  }
  const subreddits: string[] = body.subreddits ?? []
  const SUBREDDIT_RE = /^[a-zA-Z0-9_]{1,50}$/
  const badSub = subreddits.find(s => !SUBREDDIT_RE.test(s))
  if (badSub) return NextResponse.json({ error: `Invalid subreddit name: "${badSub}"` }, { status: 400 })

  const id = crypto.randomUUID()
  await execute(
    `INSERT INTO products (id, name, url, description, problems_solved, features, target_audience,
      reply_tone, promotion_intensity, keywords, subreddits, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, body.name, body.url, body.description, body.problemsSolved,
      body.features, body.targetAudience,
      body.replyTone ?? 'helpful and friendly',
      body.promotionIntensity ?? 'moderate',
      JSON.stringify(body.keywords ?? []),
      JSON.stringify(body.subreddits ?? []),
      body.isActive !== false ? 1 : 0,
    ]
  )

  const [row] = await query<{ id: string; name: string; url: string; description: string; problems_solved: string; features: string; target_audience: string; reply_tone: string; promotion_intensity: string; keywords: string; subreddits: string; is_active: number; created_at: string }>(
    'SELECT * FROM products WHERE id = ?', [id]
  )
  return NextResponse.json({
    ...row,
    problemsSolved: row.problems_solved,
    targetAudience: row.target_audience,
    replyTone: row.reply_tone,
    promotionIntensity: row.promotion_intensity,
    isActive: row.is_active === 1,
    keywords: JSON.parse(row.keywords),
    subreddits: JSON.parse(row.subreddits),
  }, { status: 201 })
}
