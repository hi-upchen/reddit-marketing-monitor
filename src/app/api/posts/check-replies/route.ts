/**
 * POST /api/posts/check-replies
 * Polls Reddit for updated scores on posted comments.
 * Called by the cron scheduler or manually from /analytics.
 */
import { NextResponse } from 'next/server'
import { db } from '@/db'
import { replyDrafts } from '@/db/schema'
import { eq, and, isNotNull } from 'drizzle-orm'
import { getToken } from '@/lib/reddit-auth'

export async function POST() {
  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'Reddit not connected' }, { status: 401 })

  // Find all posted drafts that have a comment ID
  const posted = await db
    .select()
    .from(replyDrafts)
    .where(and(eq(replyDrafts.isPosted, true), isNotNull(replyDrafts.redditCommentId)))
    .limit(20) // process up to 20 at a time

  let updated = 0
  for (const draft of posted) {
    if (!draft.redditCommentId) continue
    try {
      const res = await fetch(
        `https://oauth.reddit.com/api/info.json?id=t1_${draft.redditCommentId}`,
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            'User-Agent': 'RedditMarketingMonitor/1.0',
          },
        }
      )
      if (!res.ok) continue
      const data = await res.json()
      const comment = data?.data?.children?.[0]?.data
      if (!comment) continue

      await db
        .update(replyDrafts)
        .set({ commentScore: comment.score ?? 0 })
        .where(eq(replyDrafts.id, draft.id))
      updated++
    } catch (e) {
      console.error(`[check-replies] Failed to update comment ${draft.redditCommentId}:`, e)
    }
  }

  return NextResponse.json({ updated })
}
