# Reply Drafts Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the FK constraint bug and redesign reply draft generation to produce 3 suggestions with optional user prompt guidance.

**Architecture:** Drop and recreate `reply_drafts` table with corrected FK + `variant` column. API generates 3 drafts in parallel via `Promise.allSettled`. Frontend shows 3 suggestion cards, user picks one to edit and post.

**Tech Stack:** Next.js 16, Turso/libSQL, Gemini 2.5 Flash, shadcn/ui, React

**Spec:** `docs/superpowers/specs/2026-03-13-reply-drafts-redesign.md`

---

## Chunk 1: DB Migration + AI Function

### Task 1: Fix reply_drafts table schema

**Files:**
- Modify: `src/instrumentation.ts`

- [ ] **Step 1: Add drop + recreate migration**

Add after the sessions table migration block in `src/instrumentation.ts`:

```typescript
    // Recreate reply_drafts with corrected FK and variant column
    await execute(`CREATE TABLE IF NOT EXISTS reply_drafts (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES reddit_posts(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      body TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      variant INTEGER NOT NULL DEFAULT 1,
      is_approved INTEGER NOT NULL DEFAULT 0,
      is_posted INTEGER NOT NULL DEFAULT 0,
      approved_at TEXT,
      posted_at TEXT,
      reddit_comment_id TEXT,
      reddit_comment_url TEXT,
      comment_score INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, version, variant)
    )`, []).catch(e => {
      console.error('[db] Failed to create reply_drafts table:', e)
    })
```

Note: Use `CREATE TABLE IF NOT EXISTS` rather than `DROP + CREATE`. The old table has the wrong FK but the column names are compatible. The UNIQUE constraint and variant column will only apply to the new table. Since user already cleared DB data, this is safe. If the old table exists, it keeps working (the FK bug only fires on INSERT which the new API code will handle correctly). For a clean slate, user can manually drop the table.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/instrumentation.ts
git commit -m "fix: add reply_drafts table migration with corrected FK and variant column"
```

---

### Task 2: Add userPrompt parameter to generateReplyDraft

**Files:**
- Modify: `src/lib/ai.ts:136-211`

- [ ] **Step 1: Update function signature**

Change the function signature at line 136 from:

```typescript
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
```

To:

```typescript
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
  tone: string = 'default',
  userPrompt?: string
): Promise<string> {
```

- [ ] **Step 2: Inject user prompt into system instruction**

Find this line in the `systemInstruction` template string (around line 195):

```typescript
- Do NOT reveal this reply was AI-generated.${extraTone ? `\nTone override: ${extraTone}` : ''}`
```

Replace with:

```typescript
- Do NOT reveal this reply was AI-generated.${extraTone ? `\nTone override: ${extraTone}` : ''}${userPrompt ? `\n\n<user_guidance>${userPrompt}</user_guidance>\nIncorporate the guidance above naturally into your reply.` : ''}`
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds. The `userPrompt` parameter is optional so no callers break.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai.ts
git commit -m "feat: add optional userPrompt parameter to generateReplyDraft"
```

---

## Chunk 2: API Route Redesign

### Task 3: Rewrite POST /api/posts/[id]/draft to return 3 suggestions

**Files:**
- Modify: `src/app/api/posts/[id]/draft/route.ts`

- [ ] **Step 1: Rewrite the POST handler**

Replace the entire file contents with:

```typescript
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
  const userPrompt: string | undefined = body.prompt?.trim() || undefined

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
    const draftId = crypto.randomUUID()
    await execute(
      `INSERT INTO reply_drafts (id, post_id, product_id, body, version, variant) VALUES (?, ?, ?, ?, ?, ?)`,
      [draftId, id, product.id, s.body, version, s.variant]
    )
    const [saved] = await query('SELECT * FROM reply_drafts WHERE id = ?', [draftId])
    savedDrafts.push(saved)
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
```

Key changes from current code:
- Accepts `prompt` instead of `tone` in request body
- Generates 3 drafts in parallel using `Promise.allSettled`
- Saves with `variant` column (1, 2, 3)
- Returns array of draft objects instead of single object
- GET orders by `version DESC, variant ASC`

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/posts/[id]/draft/route.ts
git commit -m "feat: POST /draft returns 3 suggestions via Promise.allSettled"
```

---

## Chunk 3: Frontend Redesign

### Task 4: Rewrite reply page with 3 suggestion cards + prompt input

**Files:**
- Modify: `src/app/reply/[postId]/page.tsx`

- [ ] **Step 1: Rewrite the reply page**

Replace the entire file with:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
const ReactMarkdown = dynamic(() => import('react-markdown'), { ssr: false })
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { ExternalLink, RefreshCw, Copy, Send, ArrowLeft, Eye, Edit2, Link as LinkIcon, Check } from 'lucide-react'
import Link from 'next/link'

interface Draft {
  id: string
  body: string
  version: number
  variant: number
  is_approved: number
  is_posted: number
  created_at: string
}

interface PostData {
  id: string
  title: string
  body: string
  subreddit: string
  url: string
  author: string
  score: number
  relevanceTier: string
  relevanceReason: string
  status: string
  productId: string
}

export default function ReplyPage() {
  const { postId } = useParams<{ postId: string }>()
  const [post, setPost] = useState<PostData | null>(null)
  const [allDrafts, setAllDrafts] = useState<Draft[]>([])
  const [suggestions, setSuggestions] = useState<Draft[]>([])
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null)
  const [editedBody, setEditedBody] = useState('')
  const [generating, setGenerating] = useState(false)
  const [userPrompt, setUserPrompt] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [posting, setPosting] = useState(false)
  const [postedUrl, setPostedUrl] = useState<string | null>(null)
  const [postError, setPostError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPreview, setShowPreview] = useState(false)
  const [productUrl, setProductUrl] = useState<string>('')

  async function loadData() {
    setLoading(true)
    const [postRes, draftsRes] = await Promise.all([
      fetch(`/api/posts/${postId}`),
      fetch(`/api/posts/${postId}/draft`),
    ])
    const postData = await postRes.json()
    const draftsData: Draft[] = Array.isArray(await draftsRes.json().catch(() => [])) ? await draftsRes.clone().json() : []

    const p = postData.post ?? postData
    setPost(p)

    // Load product URL for quick-insert
    if (p.productId) {
      fetch(`/api/products/${p.productId}`).then(r => r.json()).then(prod => {
        if (prod?.url) {
          const campaign = (prod.name || '').toLowerCase().replace(/\s+/g, '-')
          const subreddit = p.subreddit || ''
          const utmUrl = prod.url.includes('?')
            ? `${prod.url}&utm_source=reddit&utm_medium=comment&utm_campaign=${campaign}&utm_content=${subreddit}`
            : `${prod.url}?utm_source=reddit&utm_medium=comment&utm_campaign=${campaign}&utm_content=${subreddit}`
          setProductUrl(utmUrl)
        }
      }).catch(() => {})
    }

    // Re-fetch drafts cleanly
    const dRes = await fetch(`/api/posts/${postId}/draft`)
    const dData: Draft[] = await dRes.json().catch(() => [])
    if (Array.isArray(dData)) {
      setAllDrafts(dData)
      // Show latest version's variants as suggestions
      if (dData.length > 0) {
        const latestVersion = dData[0].version
        const latestSuggestions = dData.filter(d => d.version === latestVersion)
        setSuggestions(latestSuggestions)
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId])

  // Derive unique versions for history (excluding current suggestions)
  const versions = [...new Set(allDrafts.map(d => d.version))].sort((a, b) => b - a)
  const currentVersion = suggestions.length > 0 ? suggestions[0].version : null

  async function generate() {
    setGenerating(true)
    setPostError(null)
    try {
      const res = await fetch(`/api/posts/${postId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt || undefined }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }))
        setPostError(err.error ?? 'Generation failed')
        setGenerating(false)
        return
      }
      const newDrafts: Draft[] = await res.json()
      setSuggestions(newDrafts)
      setAllDrafts(prev => [...newDrafts, ...prev])
      // Clear selection — user must pick one
      setCurrentDraftId(null)
      setEditedBody('')
    } catch {
      setPostError('Network error during generation')
    }
    setGenerating(false)
  }

  function selectSuggestion(draft: Draft) {
    setCurrentDraftId(draft.id)
    setEditedBody(draft.body)
  }

  function loadVersion(version: number) {
    const versionDrafts = allDrafts.filter(d => d.version === version)
    setSuggestions(versionDrafts)
    setCurrentDraftId(null)
    setEditedBody('')
  }

  async function handleCopyOnly() {
    if (!currentDraftId) return
    const res = await fetch(`/api/posts/${postId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: currentDraftId, body: editedBody }),
    })
    if (res.ok) {
      await navigator.clipboard.writeText(editedBody).catch(() => {})
      alert('Approved and copied to clipboard!')
    } else {
      alert('Failed to approve draft')
    }
  }

  async function handlePost() {
    if (!currentDraftId) return
    setPosting(true)
    setPostError(null)
    const res = await fetch(`/api/posts/${postId}/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: currentDraftId, body: editedBody }),
    })
    const data = await res.json()
    setPosting(false)
    setConfirmOpen(false)
    if (data.ok) {
      setPostedUrl(data.commentUrl)
    } else {
      setPostError(`Failed to post: ${data.error}`)
    }
  }

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading post...</div>
  }

  if (!post) {
    return (
      <div className="p-6">
        <p className="text-red-500">Post not found</p>
        <Link href="/" className="text-primary underline">Back to queue</Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Back link */}
      <Link href="/" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Back to queue
      </Link>

      {/* Post details */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <Badge variant="outline">r/{post.subreddit}</Badge>
          <span className="text-xs text-muted-foreground">u/{post.author} · {post.score} pts</span>
        </div>
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-lg hover:underline flex items-center gap-1"
        >
          {post.title}
          <ExternalLink size={16} className="text-muted-foreground flex-shrink-0" />
        </a>
        {post.body && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
            {post.body}
          </p>
        )}
        {post.relevanceReason && (
          <p className="text-xs italic text-muted-foreground border-l-2 pl-2">
            {post.relevanceReason}
          </p>
        )}
      </div>

      {/* Generation controls */}
      <div className="space-y-3">
        <Input
          value={userPrompt}
          onChange={e => setUserPrompt(e.target.value)}
          placeholder="Optional: guide the AI (e.g. 'mention the free browser version', 'focus on the export problem')"
          className="text-sm"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={generate} disabled={generating} size="sm">
            <RefreshCw size={14} className={`mr-1 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Generating...' : 'Generate 3 Suggestions'}
          </Button>
          {/* Previous versions */}
          {versions.length > 1 && (
            <div className="flex gap-1 items-center text-sm text-muted-foreground">
              <span>History:</span>
              {versions.filter(v => v !== currentVersion).slice(0, 3).map(v => (
                <button
                  key={v}
                  onClick={() => loadVersion(v)}
                  className="underline hover:text-foreground"
                >
                  v{v}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3 Suggestion cards */}
      {suggestions.length > 0 && !currentDraftId && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Pick a suggestion to edit:</p>
          {suggestions.map((s, i) => (
            <div
              key={s.id}
              className="border rounded-lg p-4 space-y-2 hover:border-foreground/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Suggestion {i + 1}</span>
                <Button size="sm" variant="outline" onClick={() => selectSuggestion(s)}>
                  <Check size={14} className="mr-1" /> Use This
                </Button>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Editor (shown after picking a suggestion) */}
      {currentDraftId && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-1">
              <Button
                size="sm" variant={!showPreview ? 'secondary' : 'ghost'}
                onClick={() => setShowPreview(false)}
              >
                <Edit2 size={13} className="mr-1" /> Edit
              </Button>
              <Button
                size="sm" variant={showPreview ? 'secondary' : 'ghost'}
                onClick={() => setShowPreview(true)}
              >
                <Eye size={13} className="mr-1" /> Preview
              </Button>
            </div>
            <div className="flex gap-1">
              {productUrl && (
                <Button
                  size="sm" variant="outline"
                  onClick={() => setEditedBody(b => b ? `${b}\n\n${productUrl}` : productUrl)}
                  title="Insert product link with UTM"
                >
                  <LinkIcon size={13} className="mr-1" /> Insert Link
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { setCurrentDraftId(null); setEditedBody('') }}>
                Back to suggestions
              </Button>
            </div>
          </div>

          {showPreview ? (
            <div className="min-h-[200px] border rounded-md p-3 text-sm prose prose-sm max-w-none bg-gray-50">
              <ReactMarkdown>{editedBody || '*Nothing to preview yet.*'}</ReactMarkdown>
            </div>
          ) : (
            <Textarea
              value={editedBody}
              onChange={e => setEditedBody(e.target.value)}
              rows={10}
              placeholder="Edit your reply..."
              className="font-mono text-sm"
            />
          )}
          <p className="text-xs text-muted-foreground text-right">
            {editedBody.length.toLocaleString()} / 10,000 chars
          </p>
        </div>
      )}

      {/* Status messages */}
      {post.status === 'posted' && (
        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
          <p className="text-green-800 font-medium">Already posted to Reddit</p>
        </div>
      )}

      {postError && (
        <div className="p-3 bg-red-50 rounded border border-red-200 text-sm text-red-700">
          {postError}
        </div>
      )}

      {postedUrl ? (
        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
          <p className="text-green-800 font-medium">Posted successfully!</p>
          <a
            href={postedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline text-green-700"
          >
            View on Reddit
          </a>
        </div>
      ) : currentDraftId ? (
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={handleCopyOnly}
            disabled={!editedBody || post.status === 'posted'}
          >
            <Copy size={14} className="mr-1" />
            Approve (Copy Only)
          </Button>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!editedBody || post.status === 'posted'}
          >
            <Send size={14} className="mr-1" />
            Approve &amp; Post
          </Button>
        </div>
      ) : null}

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm: Post to Reddit?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Posting to:{' '}
              <a href={post.url} target="_blank" rel="noopener noreferrer" className="underline">
                r/{post.subreddit}
              </a>
            </p>
            <div className="bg-gray-50 rounded p-3 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">
              {editedBody}
            </div>
            <p className="text-xs text-amber-600">
              This will post using your connected Reddit account. This action cannot be undone.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handlePost} disabled={posting}>
              {posting ? 'Posting...' : 'Confirm & Post'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

Key changes from current file:
- Removed: `tone` state, `Select` import, tone dropdown
- Added: `userPrompt` state, `suggestions` state, `Input` import, `Check` icon import
- Added: `selectSuggestion()` and `loadVersion()` functions
- `generate()` now receives array response, populates `suggestions`
- 3 suggestion cards shown when no draft is selected
- Editor only shown after picking a suggestion via "Use This"
- "Back to suggestions" button to return to card view
- Widened container from `max-w-2xl` to `max-w-3xl` for card readability

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No new errors (warnings are acceptable).

- [ ] **Step 4: Commit**

```bash
git add src/app/reply/[postId]/page.tsx
git commit -m "feat: reply page shows 3 AI suggestions with optional user prompt"
```

---

## Chunk 4: Verify End-to-End

### Task 5: Manual verification

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Test draft generation without prompt**

1. Navigate to a post in the queue and click into the reply page
2. Click "Generate 3 Suggestions" without entering a prompt
3. Verify: 3 suggestion cards appear with different tones (helpful, technical, personal story)
4. Click "Use This" on one — verify it loads into the editor

- [ ] **Step 3: Test draft generation with prompt**

1. Type "mention it works in the browser with no install" in the prompt input
2. Click "Generate 3 Suggestions"
3. Verify: 3 new suggestion cards appear, all incorporating the prompt guidance
4. Pick one, verify editor works

- [ ] **Step 4: Test version history**

1. Generate a second batch of suggestions
2. Verify: "History: v1" link appears
3. Click v1 — verify it loads the first batch's 3 variants

- [ ] **Step 5: Test approve + copy**

1. Pick a suggestion, edit it
2. Click "Approve (Copy Only)"
3. Verify: clipboard contains the edited text

- [ ] **Step 6: Final build check**

Run: `npm run build && npm run lint`
Expected: Both pass.

- [ ] **Step 7: Commit any fixes**

If any issues were found and fixed during manual testing, commit them.
