import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { products } from '@/db/schema'
import { asc } from 'drizzle-orm'

export async function GET() {
  const rows = await db.select().from(products).orderBy(asc(products.createdAt))
  // Parse JSON fields
  return NextResponse.json(rows.map(r => ({
    ...r,
    keywords: JSON.parse(r.keywords as string),
    subreddits: JSON.parse(r.subreddits as string),
  })))
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  // Validate required fields
  const required = ['name', 'url', 'description', 'problemsSolved', 'features', 'targetAudience']
  for (const field of required) {
    if (!body[field] || typeof body[field] !== 'string' || !String(body[field]).trim()) {
      return NextResponse.json({ error: `${field} is required` }, { status: 400 })
    }
  }
  if (!body.url.startsWith('http')) {
    return NextResponse.json({ error: 'url must start with http:// or https://' }, { status: 400 })
  }

  const [row] = await db.insert(products).values({
    name: body.name,
    url: body.url,
    description: body.description,
    problemsSolved: body.problemsSolved,
    features: body.features,
    targetAudience: body.targetAudience,
    replyTone: body.replyTone ?? 'helpful and friendly',
    promotionIntensity: body.promotionIntensity ?? 'moderate',
    keywords: JSON.stringify(body.keywords ?? []),
    subreddits: JSON.stringify(body.subreddits ?? []),
    isActive: body.isActive ?? true,
  }).returning()

  return NextResponse.json({
    ...row,
    keywords: JSON.parse(row.keywords as string),
    subreddits: JSON.parse(row.subreddits as string),
  }, { status: 201 })
}
