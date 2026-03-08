'use client'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface TierCount {
  tier: string
  count: number
}

interface SubredditCount {
  subreddit: string
  count: number
}

interface KeywordCount {
  keyword: string
  count: number
}

interface AnalyticsData {
  total: number
  byTier: TierCount[]
  bySubreddit: SubredditCount[]
  byKeyword: KeywordCount[]
  replyRate: number
  posted: number
  totalHigh: number
  days: number
}

const TIER_COLORS: Record<string, string> = {
  high: 'text-green-700',
  medium: 'text-yellow-700',
  low: 'text-gray-600',
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [days, setDays] = useState('30')
  const [productFilter, setProductFilter] = useState('all')
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetch('/api/products')
      .then(r => r.json())
      .then(setProducts)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams({ days })
    if (productFilter !== 'all') params.set('productId', productFilter)
    fetch(`/api/analytics?${params}`)
      .then(r => r.json())
      .then(setData)
  }, [days, productFilter])

  if (!data) {
    return <div className="p-6 text-muted-foreground">Loading analytics...</div>
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <div className="flex gap-2">
          <Select value={productFilter} onValueChange={(v) => setProductFilter(v ?? 'all')}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Products" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Products</SelectItem>
              {products.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={days} onValueChange={(v) => setDays(v ?? "30")}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Total posts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Total Posts Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-4xl font-bold">{data.total}</p>
          <p className="text-xs text-muted-foreground">
            in the last {data.days} days
          </p>
        </CardContent>
      </Card>

      {/* Posts by tier */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {['high', 'medium', 'low'].map(tier => {
          const tierData = data.byTier.find(t => t.tier === tier)
          return (
            <Card key={tier}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm capitalize ${TIER_COLORS[tier]}`}>
                  {tier} relevance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{tierData?.count ?? 0}</p>
              </CardContent>
            </Card>
          )
        })}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Reply Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.replyRate}%</p>
            <p className="text-xs text-muted-foreground">
              {data.posted} of {data.totalHigh} high posts replied
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top subreddits */}
        <div>
          <h2 className="font-semibold mb-3">Top Subreddits</h2>
          {data.bySubreddit.length === 0 ? (
            <p className="text-muted-foreground text-sm">No data yet</p>
          ) : (
            <div className="space-y-1">
              {data.bySubreddit.map(s => (
                <div key={s.subreddit} className="flex justify-between text-sm border-b py-1.5">
                  <span>r/{s.subreddit}</span>
                  <span className="text-muted-foreground">{s.count} posts</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top keywords */}
        <div>
          <h2 className="font-semibold mb-3">Top Keywords</h2>
          {(data.byKeyword ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">No data yet</p>
          ) : (
            <div className="space-y-1">
              {data.byKeyword.map(k => (
                <div key={k.keyword} className="flex justify-between text-sm border-b py-1.5">
                  <span className="font-mono text-xs">{k.keyword}</span>
                  <span className="text-muted-foreground">{k.count} posts</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
