'use client'
import { useState, useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ExternalLink, BookmarkIcon, SkipForward, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react'

const TIER_COLORS: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-600',
}

interface Post {
  id: string
  subreddit: string
  title: string
  body: string
  author: string
  score: number
  commentCount: number
  url: string
  redditCreatedAt: string
  matchedKeywords: string[]
  relevanceTier: string
  relevanceReason: string
  status: string
  productId: string
}

interface PostCardProps {
  post: Post
  productName: string
  onAction: (id: string, action: string) => void
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(h / 24)
  return d > 0 ? `${d}d ago` : h > 0 ? `${h}h ago` : 'just now'
}

export function PostCard({ post, productName, onAction }: PostCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showUndo, setShowUndo] = useState(false)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  async function handleSkip() {
    await onAction(post.id, 'skipped')
    setShowUndo(true)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setShowUndo(false), 6000)
  }

  const body = post.body ?? ''

  return (
    <Card className="relative">
      <CardContent className="pt-4 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <Badge variant="outline">r/{post.subreddit}</Badge>
          <Badge variant="secondary">{productName}</Badge>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIER_COLORS[post.relevanceTier] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {post.relevanceTier}
          </span>
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

        {body && (
          <p className="text-sm text-muted-foreground">
            {expanded ? body : body.slice(0, 200)}
            {body.length > 200 && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="ml-1 text-primary hover:underline inline-flex items-center gap-0.5"
              >
                {expanded ? (
                  <>
                    <ChevronUp size={12} /> less
                  </>
                ) : (
                  <>
                    <ChevronDown size={12} /> more
                  </>
                )}
              </button>
            )}
          </p>
        )}

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>u/{post.author}</span>
          <span>↑ {post.score}</span>
          <span>💬 {post.commentCount}</span>
          <span>{timeAgo(post.redditCreatedAt)}</span>
          {post.matchedKeywords?.length > 0 && (
            <span>matched: {post.matchedKeywords.join(', ')}</span>
          )}
        </div>

        {post.relevanceReason && (
          <p className="text-xs italic text-muted-foreground border-l-2 border-gray-200 pl-2">
            {post.relevanceReason}
          </p>
        )}

        <div className="flex gap-2 pt-1 flex-wrap">
          <Button
            size="sm"
            onClick={() => (window.location.href = `/reply/${post.id}`)}
          >
            <MessageSquare size={14} className="mr-1" /> Draft Reply
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction(post.id, 'bookmarked')}
          >
            <BookmarkIcon size={14} className="mr-1" /> Bookmark
          </Button>
          <Button size="sm" variant="ghost" onClick={handleSkip}>
            <SkipForward size={14} className="mr-1" /> Skip
          </Button>
        </div>

        {showUndo && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            Post skipped.
            <button
              className="text-primary underline"
              onClick={() => {
                onAction(post.id, 'new')
                setShowUndo(false)
              }}
            >
              Undo
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
