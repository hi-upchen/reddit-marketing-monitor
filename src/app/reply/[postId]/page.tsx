'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
const ReactMarkdown = dynamic(() => import('react-markdown'), { ssr: false })
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { ExternalLink, RefreshCw, Copy, Send, ArrowLeft, Eye, Edit2, Link as LinkIcon } from 'lucide-react'
import Link from 'next/link'

interface Draft {
  id: string
  body: string
  version: number
  isApproved: boolean
  isPosted: boolean
  createdAt: string
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
}

export default function ReplyPage() {
  const { postId } = useParams<{ postId: string }>()
  const [post, setPost] = useState<PostData | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null)
  const [editedBody, setEditedBody] = useState('')
  const [generating, setGenerating] = useState(false)
  const [tone, setTone] = useState('default')
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
    const draftsData = await draftsRes.json()

    const p = postData.post ?? postData
    setPost(p)
    setDrafts(draftsData)

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

    if (draftsData.length > 0) {
      setCurrentDraftId(draftsData[0].id)
      setEditedBody(draftsData[0].body)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [postId])

  async function generate() {
    setGenerating(true)
    const res = await fetch(`/api/posts/${postId}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tone }),
    })
    const draft = await res.json()
    setGenerating(false)
    setDrafts(d => [draft, ...d])
    setCurrentDraftId(draft.id)
    setEditedBody(draft.body)
  }

  async function handleCopyOnly() {
    if (!currentDraftId) {
      alert('Generate a draft first')
      return
    }
    const res = await fetch(`/api/posts/${postId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: currentDraftId, body: editedBody }),
    })
    if (res.ok) {
      await navigator.clipboard.writeText(editedBody).catch(() => {})
      alert('✅ Approved and copied to clipboard!')
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
    return (
      <div className="p-6 text-muted-foreground">Loading post...</div>
    )
  }

  if (!post) {
    return (
      <div className="p-6">
        <p className="text-red-500">Post not found</p>
        <Link href="/" className="text-primary underline">← Back to queue</Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Back link */}
      <Link href="/" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Back to queue
      </Link>

      {/* Post details */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <Badge variant="outline">r/{post.subreddit}</Badge>
          <span className="text-xs text-muted-foreground">u/{post.author} · ↑ {post.score}</span>
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

      {/* Draft editor */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={tone} onValueChange={(v) => setTone(v ?? "default")}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default Tone</SelectItem>
              <SelectItem value="helpful">Helpful</SelectItem>
              <SelectItem value="technical">Technical</SelectItem>
              <SelectItem value="personal story">Personal Story</SelectItem>
              <SelectItem value="minimal">Minimal</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={generate} disabled={generating} variant="outline" size="sm">
            <RefreshCw size={14} className={`mr-1 ${generating ? 'animate-spin' : ''}`} />
            {drafts.length === 0 ? 'Generate Draft' : 'Regenerate'}
          </Button>
        </div>

        {/* Previous draft history */}
        {drafts.length > 1 && (
          <div className="flex gap-2 text-sm text-muted-foreground items-center">
            <span>Previous versions:</span>
            {drafts.slice(1, 4).map(d => (
              <button
                key={d.id}
                onClick={() => {
                  setCurrentDraftId(d.id)
                  setEditedBody(d.body)
                }}
                className={`underline hover:text-foreground ${currentDraftId === d.id ? 'font-semibold text-foreground' : ''}`}
              >
                v{d.version}
              </button>
            ))}
          </div>
        )}

        {/* Edit / Preview toggle + quick-insert */}
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
          {productUrl && (
            <Button
              size="sm" variant="outline"
              onClick={() => setEditedBody(b => b ? `${b}\n\n${productUrl}` : productUrl)}
              title="Insert product link with UTM"
            >
              <LinkIcon size={13} className="mr-1" /> Insert Product Link
            </Button>
          )}
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
            placeholder="Generate a draft or write your reply here..."
            className="font-mono text-sm"
          />
        )}
        <p className="text-xs text-muted-foreground text-right">
          {editedBody.length.toLocaleString()} / 10,000 chars
        </p>
      </div>

      {/* Post status */}
      {post.status === 'posted' && (
        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
          <p className="text-green-800 font-medium">✅ Already posted to Reddit</p>
        </div>
      )}

      {postError && (
        <div className="p-3 bg-red-50 rounded border border-red-200 text-sm text-red-700">
          {postError}
        </div>
      )}

      {postedUrl ? (
        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
          <p className="text-green-800 font-medium">✅ Posted successfully!</p>
          {postedUrl && (
            <a
              href={postedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline text-green-700"
            >
              View on Reddit →
            </a>
          )}
        </div>
      ) : (
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
      )}

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm: Post to Reddit?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Posting to:{' '}
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                r/{post.subreddit}
              </a>
            </p>
            <div className="bg-gray-50 rounded p-3 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">
              {editedBody}
            </div>
            <p className="text-xs text-amber-600">
              ⚠️ This will post using your connected Reddit account. This action cannot be undone.
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
