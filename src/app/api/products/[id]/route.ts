import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied
  const { id } = await params
  const rows = await query<{ id: string; name: string; url: string; description: string; problems_solved: string; features: string; target_audience: string; reply_tone: string; promotion_intensity: string; keywords: string; subreddits: string; is_active: number; created_at: string }>(
    'SELECT * FROM products WHERE id = ?', [id]
  )
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const row = rows[0]
  return NextResponse.json({
    ...row,
    problemsSolved: row.problems_solved,
    targetAudience: row.target_audience,
    replyTone: row.reply_tone,
    promotionIntensity: row.promotion_intensity,
    isActive: row.is_active === 1,
    keywords: JSON.parse(row.keywords),
    subreddits: JSON.parse(row.subreddits),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied
  const { id } = await params
  const body = await req.json()

  const COLUMN_MAP: Record<string, string> = {
    name: 'name', url: 'url', description: 'description',
    problemsSolved: 'problems_solved', features: 'features',
    targetAudience: 'target_audience', replyTone: 'reply_tone',
    promotionIntensity: 'promotion_intensity', keywords: 'keywords',
    subreddits: 'subreddits', isActive: 'is_active',
  }
  const INTENSITY_VALUES = ['subtle', 'moderate', 'direct']

  const setClauses: string[] = []
  const values: (string | number | null)[] = []

  for (const [jsKey, colName] of Object.entries(COLUMN_MAP)) {
    if (body[jsKey] === undefined) continue

    if (jsKey === 'name' && (!body.name?.trim())) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    if (jsKey === 'url' && !/^https?:\/\/.+/.test(body.url)) return NextResponse.json({ error: 'url must start with http:// or https://' }, { status: 400 })
    if (jsKey === 'promotionIntensity' && !INTENSITY_VALUES.includes(body.promotionIntensity)) return NextResponse.json({ error: 'promotionIntensity must be subtle, moderate, or direct' }, { status: 400 })
    if (jsKey === 'subreddits' && Array.isArray(body.subreddits)) {
      const badSub = body.subreddits.find((s: string) => !/^[a-zA-Z0-9_]{1,50}$/.test(s))
      if (badSub) return NextResponse.json({ error: `Invalid subreddit: "${badSub}"` }, { status: 400 })
    }

    setClauses.push(`${colName} = ?`)
    if (jsKey === 'keywords' || jsKey === 'subreddits') values.push(JSON.stringify(body[jsKey]))
    else if (jsKey === 'isActive') values.push(body.isActive ? 1 : 0)
    else values.push(body[jsKey])
  }

  if (!setClauses.length) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

  await execute(`UPDATE products SET ${setClauses.join(', ')} WHERE id = ?`, [...values, id])

  const rows = await query<{ id: string; name: string; url: string; description: string; problems_solved: string; features: string; target_audience: string; reply_tone: string; promotion_intensity: string; keywords: string; subreddits: string; is_active: number; created_at: string }>(
    'SELECT * FROM products WHERE id = ?', [id]
  )
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const row = rows[0]
  return NextResponse.json({
    ...row,
    problemsSolved: row.problems_solved,
    targetAudience: row.target_audience,
    replyTone: row.reply_tone,
    promotionIntensity: row.promotion_intensity,
    isActive: row.is_active === 1,
    keywords: JSON.parse(row.keywords),
    subreddits: JSON.parse(row.subreddits),
  })
}
