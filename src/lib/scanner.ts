import { db } from '@/db'
import { products, redditPosts, scanLogs, appSettings } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { getToken } from './reddit-auth'
import { scorePostRelevance } from './ai'
import { sendNewPostsNotification } from './notify'

interface RedditPostData {
  id: string
  title: string
  selftext: string
  author: string
  score: number
  num_comments: number
  url: string
  subreddit: string
  created_utc: number
  permalink: string
}

const REDDIT_OAUTH_URL = 'https://oauth.reddit.com'
const REDDIT_PUBLIC_URL = 'https://www.reddit.com'
const USER_AGENT = 'RedditMarketingMonitor/1.0 (personal tool)'
// Public API: ~10 req/min limit → 7s delay. OAuth API: 100 req/min → 1.2s delay.
const DELAY_MS_PUBLIC = 7000
const DELAY_MS_OAUTH = 1200
const MAX_BODY_CHARS = 2000

async function getScanSettings(): Promise<{ daysBack: number }> {
  try {
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, 'scan_settings'))
    if (rows.length) {
      const s = JSON.parse(rows[0].value)
      return { daysBack: Number(s.daysBack) || 7 }
    }
  } catch {}
  return { daysBack: 7 }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const MAX_RETRIES = 3

async function searchReddit(
  keyword: string,
  subreddit: string | null,
  daysBack: number,
  oauthToken: string | null,
  attempt = 1
): Promise<RedditPostData[]> {
  const cutoff = Math.floor(Date.now() / 1000) - daysBack * 86400

  // Use OAuth API if token available, otherwise fall back to public API
  const baseUrl = oauthToken ? REDDIT_OAUTH_URL : REDDIT_PUBLIC_URL
  let url: string
  if (subreddit) {
    url = `${baseUrl}/r/${subreddit}/search.json?q=${encodeURIComponent(keyword)}&restrict_sr=on&sort=new&t=week&limit=25`
  } else {
    url = `${baseUrl}/search.json?q=${encodeURIComponent(keyword)}&sort=new&t=week&limit=25`
  }

  const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
  if (oauthToken) headers['Authorization'] = `Bearer ${oauthToken}`

  const res = await fetch(url, { headers })

  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) {
      throw new Error(`Reddit rate limit exceeded after ${MAX_RETRIES} retries`)
    }
    const retryAfter = Math.min(parseInt(res.headers.get('retry-after') ?? '60', 10), 120)
    console.log(`[scanner] Rate limited. Waiting ${retryAfter}s... (attempt ${attempt}/${MAX_RETRIES})`)
    await sleep(retryAfter * 1000)
    return searchReddit(keyword, subreddit, daysBack, oauthToken, attempt + 1)
  }

  if (!res.ok) {
    throw new Error(`Reddit search failed: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  return (data.data?.children ?? [])
    .map((c: { data: RedditPostData }) => c.data)
    .filter((p: RedditPostData) => p.created_utc > cutoff)
}

export async function cleanupStaleScanLogs() {
  // Mark any scan that's been 'running' for more than 10 minutes as failed
  // (handles server restarts mid-scan)
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  await db
    .update(scanLogs)
    .set({ status: 'failed', errorMessage: 'Scan interrupted (server restart)', completedAt: new Date().toISOString() })
    .where(and(eq(scanLogs.status, 'running'), sql`started_at < ${tenMinutesAgo}`))
}

export async function runScan(triggeredBy: 'manual' | 'scheduled' = 'manual') {
  // Clean up any orphaned running scans before checking
  await cleanupStaleScanLogs()

  // Check if a scan is already running
  const running = await db
    .select()
    .from(scanLogs)
    .where(eq(scanLogs.status, 'running'))

  if (running.length > 0) {
    throw new Error('A scan is already in progress')
  }

  const [log] = await db
    .insert(scanLogs)
    .values({ triggeredBy, status: 'running' })
    .returning()

  const updateLog = (data: Record<string, unknown>) =>
    db
      .update(scanLogs)
      .set({ ...data, completedAt: new Date().toISOString() })
      .where(eq(scanLogs.id, log.id))

  const newHighPosts: Array<{
    id: string
    title: string
    subreddit: string
    url: string
    relevanceReason: string
    relevanceTier: string
  }> = []

  try {
    const { daysBack } = await getScanSettings()

    // Try OAuth first; fall back to public API if not connected
    const token = await getToken().catch(() => null)
    const oauthToken = token?.accessToken ?? null
    const DELAY_MS = oauthToken ? DELAY_MS_OAUTH : DELAY_MS_PUBLIC

    if (!oauthToken) {
      console.log('[scanner] No Reddit OAuth token — using public API (read-only, 10 req/min)')
    }

    const activeProducts = await db
      .select()
      .from(products)
      .where(eq(products.isActive, true))

    if (!activeProducts.length) {
      await updateLog({ status: 'completed', postsFound: 0, newPosts: 0, claudeCalls: 0 })
      return { postsFound: 0, newPosts: 0 }
    }

    let totalFound = 0
    let totalNew = 0
    let totalClaudeCalls = 0

    for (const product of activeProducts) {
      const keywords = JSON.parse(product.keywords as string) as string[]
      const subreddits = JSON.parse(product.subreddits as string) as string[]

      // Collect unique posts per product (dedup by reddit post ID within this scan)
      const seenInThisScan = new Map<
        string,
        { post: RedditPostData; matchedKeywords: string[] }
      >()

      for (const keyword of keywords) {
        const searchTargets = subreddits.length > 0 ? subreddits : [null]

        for (const sub of searchTargets) {
          try {
            const posts = await searchReddit(keyword, sub, daysBack, oauthToken)
            totalFound += posts.length

            for (const post of posts) {
              if (seenInThisScan.has(post.id)) {
                seenInThisScan.get(post.id)!.matchedKeywords.push(keyword)
              } else {
                seenInThisScan.set(post.id, { post, matchedKeywords: [keyword] })
              }
            }
          } catch (e) {
            console.error(
              `[scanner] Search error for keyword "${keyword}" in ${sub ?? 'all'}:`,
              e
            )
          }
          await sleep(DELAY_MS)
        }
      }

      // Insert new posts and score them
      for (const [redditPostId, { post, matchedKeywords }] of seenInThisScan) {
        // Check if this (post, product) combo already exists
        const existing = await db
          .select({ id: redditPosts.id })
          .from(redditPosts)
          .where(
            and(
              eq(redditPosts.redditPostId, redditPostId),
              eq(redditPosts.productId, product.id)
            )
          )

        if (existing.length > 0) continue // Already in DB for this product

        const body = (post.selftext ?? '').slice(0, MAX_BODY_CHARS)

        // AI relevance scoring
        let relevanceScore = 0
        let relevanceTier: 'high' | 'medium' | 'low' = 'low'
        let relevanceReason = 'Scoring unavailable'

        try {
          const scored = await scorePostRelevance(
            {
              name: product.name,
              description: product.description,
              problemsSolved: product.problemsSolved,
              features: product.features,
            },
            post.title,
            body
          )
          relevanceScore = scored.score
          relevanceTier = scored.tier
          relevanceReason = scored.reason
          totalClaudeCalls++
        } catch (e) {
          console.error(`[scanner] AI scoring failed for post ${redditPostId}:`, e)
        }

        const [inserted] = await db
          .insert(redditPosts)
          .values({
            redditPostId,
            productId: product.id,
            subreddit: post.subreddit,
            title: post.title,
            body,
            author: post.author,
            score: post.score,
            commentCount: post.num_comments,
            url: `https://reddit.com${post.permalink}`,
            matchedKeywords: JSON.stringify(matchedKeywords),
            relevanceScore,
            relevanceTier,
            relevanceReason,
            status: 'new',
            redditCreatedAt: new Date(post.created_utc * 1000).toISOString(),
          })
          .returning()

        totalNew++

        // Collect high-relevance posts for notification
        if (relevanceTier === 'high' || relevanceTier === 'medium') {
          newHighPosts.push({
            id: inserted.id,
            title: post.title,
            subreddit: post.subreddit,
            url: `https://reddit.com${post.permalink}`,
            relevanceReason,
            relevanceTier,
          })
        }
      }
    }

    await updateLog({
      status: 'completed',
      postsFound: totalFound,
      newPosts: totalNew,
      claudeCalls: totalClaudeCalls,
    })

    // Send notification for new high-relevance posts
    try {
      const notifSettings = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, 'notification_settings'))

      const threshold = notifSettings.length
        ? JSON.parse(notifSettings[0].value).threshold
        : 'high'

      const postsToNotify =
        threshold === 'high'
          ? newHighPosts.filter(p => p.relevanceTier === 'high')
          : newHighPosts

      await sendNewPostsNotification(postsToNotify)
    } catch (e) {
      console.error('[scanner] Notification error (non-fatal):', e)
    }

    return { postsFound: totalFound, newPosts: totalNew }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    await db
      .update(scanLogs)
      .set({ status: 'failed', errorMessage: message, completedAt: new Date().toISOString() })
      .where(eq(scanLogs.id, log.id))
    throw e
  }
}
