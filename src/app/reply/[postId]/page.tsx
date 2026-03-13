'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPreview, setShowPreview] = useState(false)
  const [productUrl, setProductUrl] = useState<string>('')

  async function loadData() {
    setLoading(true)
    setLoadError(null)
    try {
      const postRes = await fetch(`/api/posts/${postId}`)
      if (!postRes.ok) throw new Error('Failed to load post')
      const postData = await postRes.json()
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

      // Load existing drafts
      const dRes = await fetch(`/api/posts/${postId}/draft`)
      const dData = await dRes.json().catch(() => [])
      if (Array.isArray(dData)) {
        setAllDrafts(dData)
        if (dData.length > 0) {
          const latestVersion = dData[0].version
          const latestSuggestions = dData.filter((d: Draft) => d.version === latestVersion)
          setSuggestions(latestSuggestions)
        }
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load data')
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId])

  // Derive unique versions for history
  const versions = [...new Set(allDrafts.map(d => d.version))].sort((a, b) => b - a)
  const currentVersion = suggestions.length > 0 ? suggestions[0].version : null

  async function generate() {
    setGenerating(true)
    setGenerateError(null)
    try {
      const res = await fetch(`/api/posts/${postId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt || undefined }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }))
        setGenerateError(err.error ?? 'Generation failed')
        setGenerating(false)
        return
      }
      const newDrafts: Draft[] = await res.json()
      setSuggestions(newDrafts)
      setAllDrafts(prev => [...newDrafts, ...prev])
      setCurrentDraftId(null)
      setEditedBody('')
    } catch {
      setGenerateError('Network error during generation')
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

  // Ensure we have a draft ID — create one if user typed manually without selecting a suggestion
  async function ensureDraftId(): Promise<string | null> {
    if (currentDraftId) return currentDraftId
    try {
      const res = await fetch(`/api/posts/${postId}/draft/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: editedBody }),
      })
      if (!res.ok) return null
      const data = await res.json()
      setCurrentDraftId(data.id)
      return data.id
    } catch {
      return null
    }
  }

  async function handleCopyOnly() {
    setActionError(null)
    setActionSuccess(null)
    const draftId = await ensureDraftId()
    if (!draftId) { setActionError('Failed to save draft'); return }
    try {
      const res = await fetch(`/api/posts/${postId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, body: editedBody }),
      })
      if (res.ok) {
        await navigator.clipboard.writeText(editedBody).catch(() => {})
        setActionSuccess('Approved and copied to clipboard!')
        setPost(prev => prev ? { ...prev, status: 'approved' } : prev)
      } else {
        setActionError('Failed to approve draft')
      }
    } catch {
      setActionError('Network error while approving')
    }
  }

  async function handlePost() {
    setPosting(true)
    setActionError(null)
    setActionSuccess(null)
    const draftId = await ensureDraftId()
    if (!draftId) { setActionError('Failed to save draft'); setPosting(false); return }
    try {
      const res = await fetch(`/api/posts/${postId}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, body: editedBody }),
      })
      const data = await res.json()
      setConfirmOpen(false)
      if (data.ok) {
        setPostedUrl(data.commentUrl)
        setPost(prev => prev ? { ...prev, status: 'posted' } : prev)
      } else {
        setActionError(`Failed to post: ${data.error}`)
      }
    } catch {
      setConfirmOpen(false)
      setActionError('Network error while posting to Reddit')
    }
    setPosting(false)
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
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* ── Section 1: Context ── */}
      <div className="space-y-3">
        <Link href="/" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Back to queue
        </Link>
        <div className="border rounded-lg p-4 space-y-2 bg-muted/30">
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant="outline">r/{post.subreddit}</Badge>
            <span className="text-xs text-muted-foreground">u/{post.author} · {post.score} pts</span>
          </div>
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold hover:underline flex items-center gap-1"
          >
            {post.title}
            <ExternalLink size={14} className="text-muted-foreground flex-shrink-0" />
          </a>
          {post.body && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
              {post.body}
            </p>
          )}
          {post.relevanceReason && (
            <p className="text-xs italic text-muted-foreground border-l-2 pl-2">
              {post.relevanceReason}
            </p>
          )}
        </div>
      </div>

      {/* Page-level error (load failure) */}
      {loadError && (
        <div className="p-3 bg-red-50 rounded border border-red-200 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {/* ── Section 2: AI Suggestions ── */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">AI Suggestions</p>
        <div className="space-y-2">
          <Textarea
            value={userPrompt}
            onChange={e => setUserPrompt(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Optional: guide the AI (e.g. 'mention the free browser version', 'focus on the export problem', 'keep it short and casual')"
            className="text-sm resize-none"
          />
          <Button onClick={generate} disabled={generating} size="sm">
            <RefreshCw size={14} className={`mr-1 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Generating...' : 'Generate 3 Suggestions'}
          </Button>
        </div>

        {/* Generation error */}
        {generateError && (
          <div className="p-2.5 bg-red-50 rounded border border-red-200 text-sm text-red-700">
            {generateError}
          </div>
        )}

        {/* Version history */}
        {versions.length > 1 && (
          <div className="flex gap-1 items-center text-xs text-muted-foreground">
            <span>Versions:</span>
            {versions.slice(0, 5).map(v => (
              <button
                key={v}
                onClick={() => loadVersion(v)}
                className={`px-1.5 py-0.5 rounded ${v === currentVersion ? 'bg-primary text-primary-foreground' : 'hover:bg-muted underline'}`}
              >
                v{v}
              </button>
            ))}
          </div>
        )}

        {/* Loading skeleton */}
        {generating && !suggestions.length && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Generating 3 suggestions (10-15 seconds)...</p>
            {[1, 2, 3].map(i => (
              <div key={i} className="border rounded-lg p-3 animate-pulse">
                <div className="h-3 bg-muted rounded w-20 mb-2" />
                <div className="space-y-1.5">
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-5/6" />
                  <div className="h-3 bg-muted rounded w-3/5" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Suggestion cards */}
        {suggestions.length > 0 && !generating && (
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSuggestion(s) } }}
                onClick={() => selectSuggestion(s)}
                className={`border rounded-lg p-3 space-y-1.5 transition-colors cursor-pointer ${
                  currentDraftId === s.id
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    : 'hover:border-foreground/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Suggestion {i + 1}
                    {currentDraftId === s.id && <span className="text-primary ml-1">(editing)</span>}
                  </span>
                  <Button
                    size="sm"
                    variant={currentDraftId === s.id ? 'default' : 'ghost'}
                    className="h-7 text-xs"
                    onClick={e => { e.stopPropagation(); selectSuggestion(s) }}
                  >
                    <Check size={12} className="mr-1" /> Use This
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 3: Your Reply ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Your Reply</p>
          <div className="flex gap-1">
            <Button
              size="sm" variant={!showPreview ? 'secondary' : 'ghost'} className="h-7 text-xs"
              onClick={() => setShowPreview(false)}
            >
              <Edit2 size={12} className="mr-1" /> Edit
            </Button>
            <Button
              size="sm" variant={showPreview ? 'secondary' : 'ghost'} className="h-7 text-xs"
              onClick={() => setShowPreview(true)}
            >
              <Eye size={12} className="mr-1" /> Preview
            </Button>
            {productUrl && (
              <Button
                size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => setEditedBody(b => b ? `${b}\n\n${productUrl}` : productUrl)}
                title="Insert product link with UTM"
              >
                <LinkIcon size={12} className="mr-1" /> Insert Link
              </Button>
            )}
          </div>
        </div>

        {showPreview ? (
          <div className="min-h-[160px] border rounded-md p-3 text-sm prose prose-sm max-w-none bg-muted/30">
            <ReactMarkdown>{editedBody || '*Nothing to preview yet.*'}</ReactMarkdown>
          </div>
        ) : (
          <Textarea
            value={editedBody}
            onChange={e => setEditedBody(e.target.value)}
            rows={8}
            placeholder="Type your reply here, or pick a suggestion above..."
            className="font-mono text-sm"
          />
        )}

        {/* Action feedback — right above buttons where user is looking */}
        {actionError && (
          <div className="p-2.5 bg-red-50 rounded border border-red-200 text-sm text-red-700">
            {actionError}
          </div>
        )}
        {actionSuccess && (
          <div className="p-2.5 bg-green-50 rounded border border-green-200 text-sm text-green-700">
            {actionSuccess}
          </div>
        )}
        {postedUrl && (
          <div className="p-2.5 bg-green-50 rounded border border-green-200 text-sm">
            <span className="text-green-800 font-medium">Posted successfully!</span>{' '}
            <a href={postedUrl} target="_blank" rel="noopener noreferrer" className="underline text-green-700">
              View on Reddit
            </a>
          </div>
        )}
        {post.status === 'posted' && !postedUrl && (
          <div className="p-2.5 bg-green-50 rounded border border-green-200 text-sm text-green-800 font-medium">
            Already posted to Reddit
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {postedUrl ? null : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyOnly}
                  disabled={!editedBody || post.status === 'posted'}
                >
                  <Copy size={14} className="mr-1" />
                  Approve (Copy Only)
                </Button>
                <Button
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!editedBody || post.status === 'posted'}
                >
                  <Send size={14} className="mr-1" />
                  Approve &amp; Post
                </Button>
              </>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {editedBody.length.toLocaleString()} / 10,000
          </span>
        </div>
      </div>

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
            <div className="bg-muted/50 rounded p-3 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">
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
