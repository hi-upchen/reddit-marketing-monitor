import { NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { getToken } from '@/lib/reddit-auth'
import { requireAuth } from '@/lib/auth'

export async function POST() {
  const denied = await requireAuth(); if (denied) return denied
  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'Reddit not connected' }, { status: 401 })

  const posted = await query<{ id: string; reddit_comment_id: string }>(
    'SELECT id, reddit_comment_id FROM reply_drafts WHERE is_posted = 1 AND reddit_comment_id IS NOT NULL LIMIT 20'
  )

  let updated = 0
  for (const draft of posted) {
    try {
      const res = await fetch(
        `https://oauth.reddit.com/api/info.json?id=t1_${draft.reddit_comment_id}`,
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

      await execute('UPDATE reply_drafts SET comment_score = ? WHERE id = ?', [comment.score ?? 0, draft.id])
      updated++
    } catch (e) {
      console.error(`[check-replies] Failed for ${draft.reddit_comment_id}:`, e)
    }
  }

  return NextResponse.json({ updated })
}
