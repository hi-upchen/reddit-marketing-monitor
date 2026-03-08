'use client'
import { useEffect, useState, useCallback } from 'react'
import { PostCard } from '@/components/PostCard'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RefreshCw } from 'lucide-react'

interface Product {
  id: string
  name: string
}

interface PostRow {
  post: {
    id: string
    subreddit: string
    title: string
    body: string
    author: string
    score: number
    commentCount: number
    url: string
    redditCreatedAt: string
    fetchedAt: string
    matchedKeywords: string[]
    relevanceTier: string
    relevanceScore: number
    relevanceReason: string
    status: string
    productId: string
  }
  product: { id: string; name: string } | null
}

export default function DashboardPage() {
  const [allPosts, setAllPosts] = useState<PostRow[]>([])
  const [posts, setPosts] = useState<PostRow[]>([])
  const [products, setProductsList] = useState<Product[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [productFilter, setProductFilter] = useState('all')
  const [tierFilter, setTierFilter] = useState('high,medium')
  const [statusFilter, setStatusFilter] = useState('new,draft,approved,bookmarked')
  const [subredditFilter, setSubredditFilter] = useState('all')
  const [sortBy, setSortBy] = useState('relevance')
  const [lastScanned, setLastScanned] = useState<string | null>(null)

  // Load last scan time from DB on mount
  useEffect(() => {
    fetch('/api/settings/scan').then(r => r.json()).then(s => {
      if (s.lastScanAt) setLastScanned(new Date(s.lastScanAt).toLocaleString())
    }).catch(() => {})
  }, [])

  const loadPosts = useCallback(async () => {
    const params = new URLSearchParams()
    if (productFilter !== 'all') params.set('productId', productFilter)
    params.set('status', statusFilter)
    const res = await fetch(`/api/posts?${params}`)
    const data = await res.json()
    setAllPosts(data)
  }, [productFilter, statusFilter])

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(setProductsList)
  }, [])

  useEffect(() => { loadPosts() }, [loadPosts])

  // Apply client-side filters + sort
  useEffect(() => {
    let filtered = [...allPosts]

    // Tier filter
    if (tierFilter !== 'all') {
      const tiers = tierFilter.split(',')
      filtered = filtered.filter(r => tiers.includes(r.post.relevanceTier))
    }

    // Subreddit filter
    if (subredditFilter !== 'all') {
      filtered = filtered.filter(r => r.post.subreddit === subredditFilter)
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'relevance') return b.post.relevanceScore - a.post.relevanceScore
      if (sortBy === 'score') return b.post.score - a.post.score
      // newest
      return new Date(b.post.redditCreatedAt).getTime() - new Date(a.post.redditCreatedAt).getTime()
    })

    setPosts(filtered)
  }, [allPosts, tierFilter, subredditFilter, sortBy])

  // Derive unique subreddits for filter
  const subreddits = [...new Set(allPosts.map(r => r.post.subreddit))].sort()

  async function handleScanNow() {
    setScanning(true)
    setScanError(null)
    try {
      const res = await fetch('/api/scan', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setScanError(data.error ?? 'Scan failed')
      } else {
        const now = new Date().toLocaleString()
        setLastScanned(now)
        loadPosts()
      }
    } catch {
      setScanError('Network error during scan')
    } finally {
      setScanning(false)
    }
  }

  async function handleAction(id: string, status: string) {
    await fetch(`/api/posts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    loadPosts()
  }

  const productMap = Object.fromEntries(products.map(p => [p.id, p.name]))

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Post Queue</h1>
        <div className="flex items-center gap-2">
          {lastScanned && (
            <span className="text-sm text-muted-foreground">Last scan: {lastScanned}</span>
          )}
          <Button onClick={handleScanNow} disabled={scanning} size="sm">
            <RefreshCw size={14} className={`mr-1 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Scan Now'}
          </Button>
        </div>
      </div>

      {scanning && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-700 flex items-center gap-2">
          <RefreshCw size={14} className="animate-spin shrink-0" />
          Scanning Reddit for relevant posts… this can take up to 60 seconds.
        </div>
      )}
      {scanError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          Scan error: {scanError}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Select value={productFilter} onValueChange={v => setProductFilter(v ?? 'all')}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Products" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={tierFilter} onValueChange={v => setTierFilter(v ?? 'high,medium')}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Relevance" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="high,medium">High + Medium</SelectItem>
            <SelectItem value="high">High only</SelectItem>
            <SelectItem value="medium">Medium only</SelectItem>
            <SelectItem value="all">All (incl. Low)</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={v => setStatusFilter(v ?? 'new,draft,approved,bookmarked')}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="new,draft,approved,bookmarked">Active</SelectItem>
            <SelectItem value="new">New only</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
            <SelectItem value="bookmarked">Bookmarked</SelectItem>
            <SelectItem value="new,draft,approved,posted,skipped,bookmarked">All statuses</SelectItem>
          </SelectContent>
        </Select>

        {subreddits.length > 0 && (
          <Select value={subredditFilter} onValueChange={v => setSubredditFilter(v ?? 'all')}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Subreddit" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subreddits</SelectItem>
              {subreddits.map(s => <SelectItem key={s} value={s}>r/{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <Select value={sortBy} onValueChange={v => setSortBy(v ?? 'relevance')}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Sort by" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance">Highest Relevance</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="score">Highest Score</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">{posts.length} post{posts.length !== 1 ? 's' : ''}</p>

      {/* Post list */}
      <div className="space-y-3">
        {posts.map(r => (
          <PostCard
            key={r.post.id}
            post={r.post}
            productName={productMap[r.post.productId] ?? r.product?.name ?? ''}
            onAction={handleAction}
          />
        ))}
        {posts.length === 0 && !scanning && (
          <div className="text-center text-muted-foreground py-12 space-y-2">
            <p>No posts found matching current filters.</p>
            <p className="text-sm">Try running a scan or changing the filters.</p>
          </div>
        )}
      </div>
    </div>
  )
}
