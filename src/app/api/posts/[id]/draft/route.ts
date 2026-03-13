import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { generateReplyDraft } from '@/lib/ai'
import { requireAuth } from '@/lib/auth'

// Preset tones when no user prompt is provided
const PRESET_TONES = ['helpful', 'technical', 'personal story'] as const

// Angle instructions when user provides a prompt (to differentiate 3 outputs)
const PROMPT_ANGLES = [
  'Write a concise, direct reply.',
  'Write a warm, detailed reply.',
  'Write the reply as a personal experience.',
] as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (rawPrompt.length > 500) {
    return NextResponse.json({ error: 'Prompt must be 500 characters or less' }, { status: 400 })
  }
  const userPrompt: string | undefined = rawPrompt || undefined

  // Fetch post
  const posts = await query<{
    id: string; product_id: string; title: string; body: string; subreddit: string
  }>('SELECT id, product_id, title, body, subreddit FROM reddit_posts WHERE id = ?', [id])
  if (!posts.length) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  const post = posts[0]

  // Fetch product
  const products = await query<{
    id: string; name: string; url: string; description: string; problems_solved: string
    features: string; target_audience: string; reply_tone: string; promotion_intensity: string
  }>('SELECT * FROM products WHERE id = ?', [post.product_id])
  if (!products.length) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  const product = products[0]

  const productPayload = {
    name: product.name,
    url: product.url,
    description: product.description,
    problemsSolved: product.problems_solved,
    features: product.features,
    targetAudience: product.target_audience,
    replyTone: product.reply_tone,
    promotionIntensity: product.promotion_intensity,
  }
  const postPayload = { title: post.title, body: post.body, subreddit: post.subreddit }

  // Generate 3 variations in parallel
  const generationPromises = userPrompt
    ? PROMPT_ANGLES.map(angle =>
        generateReplyDraft(productPayload, postPayload, 'default', `${userPrompt}\n${angle}`)
      )
    : PRESET_TONES.map(tone =>
        generateReplyDraft(productPayload, postPayload, tone)
      )

  const results = await Promise.allSettled(generationPromises)
  const succeeded = results
    .map((r, i) => r.status === 'fulfilled' ? { body: r.value, variant: i + 1 } : null)
    .filter((r): r is { body: string; variant: number } => r !== null)

  if (succeeded.length === 0) {
    return NextResponse.json({ error: 'All draft generations failed' }, { status: 500 })
  }

  // Determine next version number
  const existingDrafts = await query<{ version: number }>(
    'SELECT version FROM reply_drafts WHERE post_id = ? ORDER BY version DESC LIMIT 1', [id]
  )
  const version = (existingDrafts[0]?.version ?? 0) + 1

  // Save all successful drafts
  const savedDrafts = []
  for (const s of succeeded) {
    try {
      const draftId = crypto.randomUUID()
      await execute(
        `INSERT INTO reply_drafts (id, post_id, product_id, body, version, variant) VALUES (?, ?, ?, ?, ?, ?)`,
        [draftId, id, product.id, s.body, version, s.variant]
      )
      const [saved] = await query('SELECT * FROM reply_drafts WHERE id = ?', [draftId])
      savedDrafts.push(saved)
    } catch (e) {
      console.error(`[draft] Failed to save variant ${s.variant}:`, e)
    }
  }

  if (savedDrafts.length === 0) {
    return NextResponse.json({ error: 'Generated drafts but failed to save them' }, { status: 500 })
  }

  await execute(`UPDATE reddit_posts SET status = 'draft' WHERE id = ?`, [id])

  return NextResponse.json(savedDrafts)
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied
  const { id } = await params
  const drafts = await query(
    'SELECT * FROM reply_drafts WHERE post_id = ? ORDER BY version DESC, variant ASC', [id]
  )
  return NextResponse.json(drafts)
}
