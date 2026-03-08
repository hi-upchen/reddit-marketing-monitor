import { GoogleGenerativeAI } from '@google/generative-ai'

// Lazy init client — only when API key is set
function getClient(): GoogleGenerativeAI | null {
  if (!process.env.GEMINI_API_KEY) return null
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
}

interface ScoringResult {
  score: number
  tier: 'high' | 'medium' | 'low'
  reason: string
}

export async function scorePostRelevance(
  product: {
    name: string
    description: string
    problemsSolved: string
    features: string
  },
  title: string,
  body: string
): Promise<ScoringResult> {
  const client = getClient()

  // Mock fallback when no API key
  if (!client) {
    return {
      score: 5,
      tier: 'medium',
      reason: 'Mock scoring — set GEMINI_API_KEY to enable real AI scoring',
    }
  }

  const prompt = `You are evaluating Reddit posts for relevance to a product.

Product: ${product.name}
Description: ${product.description}
Problems it solves: ${product.problemsSolved}
Features: ${product.features}

Reddit post:
Title: ${title}
Body: ${body.slice(0, 1500)}

Score this post 1-10 using these strict criteria:

9-10: Post author is DIRECTLY asking how to export/access Kobo highlights, notes, or annotations. They have this exact problem right now.
7-8: Post is about a Kobo limitation that this product directly solves (e.g. sideloaded book issues, export failures, stylus annotation questions).
5-6: Kobo user who might benefit but not explicitly asking about the problem this solves.
3-4: General Kobo discussion, tangentially related.
1-2: Not relevant — general e-reader chat, hardware questions, unrelated topics.

Be strict. Most posts should score 3-5. Only score 8+ if the person is EXPLICITLY asking about exporting highlights/notes/annotations from Kobo.

Respond in this exact JSON format (nothing else):
{"score": 4, "reason": "One sentence explaining the relevance score"}`

  try {
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash-lite' })
    const result = await model.generateContent(prompt)
    const text = result.response.text()

    // Extract JSON from response (handle potential markdown code blocks)
    const jsonMatch = text.match(/\{[^}]+\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')

    const parsed = JSON.parse(jsonMatch[0])
    const score = Math.max(1, Math.min(10, parseInt(String(parsed.score))))
    const tier: 'high' | 'medium' | 'low' = score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low'

    return { score, tier, reason: parsed.reason ?? 'Relevance assessed' }
  } catch (e) {
    console.error('AI scoring error:', e)
    return {
      score: 0,
      tier: 'low',
      reason: 'Scoring unavailable',
    }
  }
}

function appendUtm(url: string, subreddit: string, campaign: string): string {
  // Don't duplicate UTM params
  if (url.includes('utm_source=reddit')) return url
  const utmParams = `utm_source=reddit&utm_medium=comment&utm_campaign=${campaign}&utm_content=${subreddit}`
  return url.includes('?') ? `${url}&${utmParams}` : `${url}?${utmParams}`
}

export async function generateReplyDraft(
  product: {
    name: string
    url: string
    description: string
    problemsSolved: string
    features: string
    targetAudience: string
    replyTone: string
    promotionIntensity: string
  },
  post: { title: string; body: string; subreddit: string },
  tone: string = 'default'
): Promise<string> {
  const client = getClient()

  // Build UTM URL
  const campaign = product.name.toLowerCase().replace(/\s+/g, '-')
  const utmUrl = appendUtm(product.url, post.subreddit, campaign)

  const toneInstructions: Record<string, string> = {
    helpful: 'Be warm and directly helpful. Focus on solving their problem.',
    technical: 'Use precise technical language. Be concise and factual.',
    'personal story': 'Write as if sharing a personal experience or discovery.',
    minimal: 'Keep it to 2-3 sentences. Very brief and to the point.',
    default: '',
  }

  const extraTone = toneInstructions[tone.toLowerCase()] ?? ''

  // Mock fallback when no API key
  if (!client) {
    return `Based on what you're describing, ${product.name} might be exactly what you need. ${product.description.split('.')[0]}.

${utmUrl}

It works entirely in the browser and handles the exact scenario you're dealing with.`
  }

  const systemInstruction = `You are helping the creator of "${product.name}" respond to Reddit posts in a genuine, helpful, non-spammy way.

Product: ${product.name}
URL: ${utmUrl}
Description: ${product.description}
Problems it solves: ${product.problemsSolved}
Key features: ${product.features}
Target audience: ${product.targetAudience}

Guidelines:
- Sound like a real person helping, not a marketer. Be genuinely helpful first.
- Mention the product naturally, not as an ad. Lead with solving their problem.
- Keep it concise (3–6 sentences max).
- Do not use salesy language, exclamation marks, or generic openers like "Hey!"
- If the product directly solves their exact problem, be clear about it.
- If only partially relevant, acknowledge limitations honestly.
- Mention the product URL once at most if relevant.
- Match the tone of r/${post.subreddit}.
- Promotion intensity: ${product.promotionIntensity} (subtle = barely mention product; direct = lead with product recommendation).
- Write in English.
- Do NOT reveal this reply was AI-generated.${extraTone ? `\nTone override: ${extraTone}` : ''}`

  const userPrompt = `Reddit post from r/${post.subreddit}:\nTitle: ${post.title}\n\n${post.body.slice(0, 1500)}\n\nWrite a reply:`

  const model = client.getGenerativeModel({
    model: 'gemini-2.0-flash-lite',
    systemInstruction,
  })
  const result = await model.generateContent(userPrompt)
  return result.response.text()
}
