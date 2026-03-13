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
    const postRes = await fetch(`/api/posts/${postId}`)
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
      // Show latest version's variants as suggestions
      if (dData.length > 0) {
        const latestVersion = dData[0].version
        const latestSuggestions = dData.filter((d: Draft) => d.version === latestVersion)
        setSuggestions(latestSuggestions)
      }
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
