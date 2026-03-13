import { query, execute } from '@/lib/db'
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
const MAX_BODY_CHARS = 2000

// Unified throttle: 1 API call per 4s for all external APIs (Reddit + Gemini)
const THROTTLE_MS = 4000

// In-memory cache for Reddit API results (3 hour TTL)
const CACHE_TTL_MS = 3 * 60 * 60 * 1000
const redditCache = new Map<string, { data: RedditPostData[]; expiresAt: number }>()

function getCached(key: string): RedditPostData[] | null {
  const entry = redditCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    redditCache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key: string, data: RedditPostData[]) {
  redditCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

async function getScanSettings(): Promise<{ daysBack: number }> {
  try {
    const rows = await query<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?',
      ['scan_settings']
    )
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

const MAX_RETRIES = 5

async function searchReddit(
  keyword: string,
  subreddit: string | null,
  daysBack: number,
  oauthToken: string | null,
  attempt = 1
): Promise<RedditPostData[]> {
  const cacheKey = `search:${subreddit ?? 'all'}:${keyword}:${daysBack}`
  const cached = getCached(cacheKey)
  if (cached) {
    console.log(`[scanner] Cache hit for "${keyword}" in ${subreddit ? `r/${subreddit}` : 'all'} (${cached.length} results)`)
    return cached
  }

  const cutoff = Math.floor(Date.now() / 1000) - daysBack * 86400
  const baseUrl = oauthToken ? REDDIT_OAUTH_URL : REDDIT_PUBLIC_URL
  let url: string
  if (subreddit) {
    url = `${baseUrl}/r/${subreddit}/search.json?q=${encodeURIComponent(keyword)}&restrict_sr=on&sort=new&t=week&limit=25`
  } else {
    url = `${baseUrl}/search.json?q=${encodeURIComponent(keyword)}&sort=new&t=week&limit=25`
  }

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  }
  if (oauthToken) headers['Authorization'] = `Bearer ${oauthToken}`

  const res = await fetch(url, { headers })

  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) throw new Error(`Reddit rate limit exceeded after ${MAX_RETRIES} retries`)
    const retryAfter = Math.min(parseInt(res.headers.get('retry-after') ?? '60', 10), 120)
    const backoff = Math.max(retryAfter, attempt * 15)
    console.log(`[scanner] Reddit 429, waiting ${backoff}s before retry ${attempt + 1}/${MAX_RETRIES}`)
    await sleep(backoff * 1000)
    return searchReddit(keyword, subreddit, daysBack, oauthToken, attempt + 1)
  }

  if (!res.ok) throw new Error(`Reddit search failed: ${res.status} ${res.statusText}`)

  const data = await res.json()
  const results = (data.data?.children ?? [])
    .map((c: { data: RedditPostData }) => c.data)
    .filter((p: RedditPostData) => p.created_utc > cutoff)

  setCache(cacheKey, results)
  return results
}


export async function cleanupStaleScanLogs() {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  await execute(
    `UPDATE scan_logs SET status = 'failed', error_message = 'Scan interrupted (server restart)', completed_at = ?
     WHERE status = 'running' AND started_at < ?`,
    [new Date().toISOString(), tenMinutesAgo]
  )
}

export async function runScan(triggeredBy: 'manual' | 'scheduled' = 'manual') {
  console.log(`[scanner] Starting ${triggeredBy} scan`)
  await cleanupStaleScanLogs()

  const running = await query('SELECT id FROM scan_logs WHERE status = ?', ['running'])
  if (running.length > 0) throw new Error('A scan is already in progress')

  const logId = crypto.randomUUID()
  await execute(
    `INSERT INTO scan_logs (id, triggered_by, status) VALUES (?, ?, 'running')`,
    [logId, triggeredBy]
  )

  // Whitelist of allowed scan_log columns to prevent SQL injection via object keys
  const ALLOWED_LOG_COLUMNS = new Set(['status', 'posts_found', 'new_posts', 'claude_calls', 'error_message'])

  const updateLog = (data: Record<string, string | number | null>) => {
    const safeKeys = Object.keys(data).filter(k => ALLOWED_LOG_COLUMNS.has(k))
    if (!safeKeys.length) return Promise.resolve()
    const sets = safeKeys.map(k => `${k} = ?`).join(', ')
    return execute(
      `UPDATE scan_logs SET ${sets}, completed_at = ? WHERE id = ?`,
      [...safeKeys.map(k => data[k]), new Date().toISOString(), logId]
    )
  }

  const newHighPosts: Array<{
    id: string
    title: string
    subreddit: string
    url: string
    relevanceReason: string
    relevanceTier: string
  }> = []

  let totalFound = 0
  let totalNew = 0
  let totalAiCalls = 0

  // Score a single post and save to DB. Returns true if saved (new post).
  async function scoreAndSave(
    post: RedditPostData,
    keyword: string,
    product: { id: string; name: string; description: string; problems_solved: string; features: string },
  ): Promise<boolean> {
    // Dedup against DB — single source of truth
    const existing = await query(
      'SELECT id FROM reddit_posts WHERE reddit_post_id = ? AND product_id = ?',
      [post.id, product.id]
    )
    if (existing.length > 0) return false

    const body = (post.selftext ?? '').slice(0, MAX_BODY_CHARS)
    let relevanceScore = 0
    let relevanceTier: 'high' | 'medium' | 'low' = 'low'
    let relevanceReason = 'Scoring unavailable'

    try {
      const scored = await scorePostRelevance(
        {
          name: product.name,
          description: product.description,
          problemsSolved: product.problems_solved,
          features: product.features,
        },
        post.title,
        body
      )
      relevanceScore = scored.score
      relevanceTier = scored.tier
      relevanceReason = scored.reason
      totalAiCalls++
      await sleep(THROTTLE_MS)
    } catch (e) {
      console.error(`[scanner] AI scoring failed for ${post.id}:`, e)
    }

    const postId = crypto.randomUUID()
    await execute(
      `INSERT INTO reddit_posts (
        id, reddit_post_id, product_id, subreddit, title, body, author, score,
        comment_count, url, matched_keywords, relevance_score, relevance_tier,
        relevance_reason, status, reddit_created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
      [
        postId, post.id, product.id, post.subreddit, post.title, body,
        post.author, post.score, post.num_comments,
        `https://reddit.com${post.permalink}`,
        JSON.stringify([keyword]),
        relevanceScore, relevanceTier, relevanceReason,
        new Date(post.created_utc * 1000).toISOString(),
      ]
    )

    totalNew++
    console.log(`[scanner]   ✓ "${post.title.slice(0, 50)}" → ${relevanceTier} (${relevanceScore})`)

    if (relevanceTier === 'high' || relevanceTier === 'medium') {
      newHighPosts.push({
        id: postId,
        title: post.title,
        subreddit: post.subreddit,
        url: `https://reddit.com${post.permalink}`,
        relevanceReason,
        relevanceTier,
      })
    }

    // Update scan log progress every 5 new posts
    if (totalNew % 5 === 0) {
      await updateLog({ status: 'running', posts_found: totalFound, new_posts: totalNew, claude_calls: totalAiCalls })
    }

    return true
  }

  try {
    const { daysBack } = await getScanSettings()

    const token = await getToken().catch(() => null)
    const oauthToken = token?.accessToken ?? null

    const activeProducts = await query<{
      id: string; name: string; description: string; problems_solved: string
      features: string; target_audience: string; reply_tone: string
      promotion_intensity: string; keywords: string; subreddits: string
    }>('SELECT * FROM products WHERE is_active = 1')

    if (!activeProducts.length) {
      console.log('[scanner] No active products found, skipping')
      await updateLog({ status: 'completed', posts_found: 0, new_posts: 0, claude_calls: 0 })
      return { postsFound: 0, newPosts: 0 }
    }

    console.log(`[scanner] Found ${activeProducts.length} active product(s), daysBack=${daysBack}, auth=${oauthToken ? 'oauth' : 'public'}`)

    for (const product of activeProducts) {
      const keywords = JSON.parse(product.keywords) as string[]
      const subreddits = JSON.parse(product.subreddits) as string[]
      console.log(`[scanner] Product "${product.name}": ${keywords.length} keywords, ${subreddits.length} subreddits`)

      // ── Keyword searches: fetch → score → save per subreddit call ──
      for (const keyword of keywords) {
        const searchTargets = subreddits.length > 0 ? subreddits : [null]
        for (const sub of searchTargets) {
          try {
            const cKey = `search:${sub ?? 'all'}:${keyword}:${daysBack}`
            const wasCached = !!getCached(cKey)
            console.log(`[scanner] Searching "${keyword}" in ${sub ? `r/${sub}` : 'all'}`)
            const posts = await searchReddit(keyword, sub, daysBack, oauthToken)
            console.log(`[scanner]   → ${posts.length} results${wasCached ? ' (cached)' : ''}`)
            totalFound += posts.length

            // Score and save each post immediately
            for (const post of posts) {
              try {
                await scoreAndSave(post, keyword, product)
              } catch (e) {
                console.error(`[scanner] Failed to process post ${post.id}:`, e)
              }
            }

            if (!wasCached) await sleep(THROTTLE_MS)
          } catch (e) {
            console.error(`[scanner] Search error for "${keyword}" in ${sub ?? 'all'}:`, e)
            await sleep(THROTTLE_MS)
          }
        }
      }

      console.log(`[scanner] Product "${product.name}" done: ${totalNew} new so far`)
    }

    console.log(`[scanner] Scan complete: ${totalFound} found, ${totalNew} new, ${totalAiCalls} AI calls`)
    await updateLog({
      status: 'completed',
      posts_found: totalFound,
      new_posts: totalNew,
      claude_calls: totalAiCalls,
    })

    try {
      const notifRows = await query<{ value: string }>(
        'SELECT value FROM app_settings WHERE key = ?',
        ['notification_settings']
      )
      const threshold = notifRows.length ? JSON.parse(notifRows[0].value).threshold : 'high'
      const postsToNotify = threshold === 'high'
        ? newHighPosts.filter(p => p.relevanceTier === 'high')
        : newHighPosts
      await sendNewPostsNotification(postsToNotify)
    } catch (e) {
      console.error('[scanner] Notification error (non-fatal):', e)
    }

    return { postsFound: totalFound, newPosts: totalNew }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    await execute(
      `UPDATE scan_logs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`,
      [message, new Date().toISOString(), logId]
    )
    throw e
  }
}
