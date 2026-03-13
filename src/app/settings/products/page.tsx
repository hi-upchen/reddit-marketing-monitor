'use client'
import { useEffect, useState } from 'react'
import { ProductForm } from '@/components/ProductForm'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

interface Product {
  id: string
  name: string
  url: string
  description: string
  problemsSolved: string
  features: string
  targetAudience: string
  replyTone: string
  promotionIntensity: 'subtle' | 'moderate' | 'direct'
  keywords: string[]
  subreddits: string[]
  isActive: boolean
}

const emptyProduct: Omit<Product, 'id'> = {
  name: '',
  url: '',
  description: '',
  problemsSolved: '',
  features: '',
  targetAudience: '',
  replyTone: 'helpful and friendly',
  promotionIntensity: 'moderate',
  keywords: [],
  subreddits: [],
  isActive: true,
}

export default function ProductsSettingsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState(emptyProduct)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const res = await fetch('/api/products')
    const data = await res.json()
    setProducts(data)
    setLoading(false)
  }

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(data => {
      setProducts(data)
      setLoading(false)
    }).catch(() => {})
  }, [])

  async function handleCreate() {
    setError('')
    if (!newForm.name.trim()) { setError('Product name is required'); return }
    if (!newForm.url.trim() || !newForm.url.startsWith('http')) { setError('URL must start with http:// or https://'); return }
    if (!newForm.description.trim()) { setError('Description is required'); return }
    if (!newForm.problemsSolved.trim()) { setError('Problems solved is required'); return }
    if (!newForm.features.trim()) { setError('Features is required'); return }
    if (!newForm.targetAudience.trim()) { setError('Target audience is required'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm),
      })
      if (res.ok) {
        setShowNew(false)
        setNewForm(emptyProduct)
        load()
      } else {
        const data = await res.json()
        setError(data.error ?? 'Failed to create product')
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-muted-foreground">Loading products...</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Product Configuration</h1>
        <Button onClick={() => setShowNew(true)} disabled={showNew} size="sm">
          <Plus size={14} className="mr-1" /> Add Product
        </Button>
      </div>

      {showNew && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <h2 className="text-lg font-semibold">New Product</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Product Name *</label>
                <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">URL *</label>
                <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={newForm.url} onChange={e => setNewForm(f => ({ ...f, url: e.target.value }))} placeholder="https://..." />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Description * (for AI context)</label>
              <textarea className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[60px]" value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Problems Solved *</label>
              <textarea className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[40px]" value={newForm.problemsSolved} onChange={e => setNewForm(f => ({ ...f, problemsSolved: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Key Features *</label>
              <textarea className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[40px]" value={newForm.features} onChange={e => setNewForm(f => ({ ...f, features: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Target Audience *</label>
              <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={newForm.targetAudience} onChange={e => setNewForm(f => ({ ...f, targetAudience: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Reply Tone</label>
                <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={newForm.replyTone} onChange={e => setNewForm(f => ({ ...f, replyTone: e.target.value }))} placeholder="e.g. helpful and friendly" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Promotion Intensity</label>
                <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={newForm.promotionIntensity} onChange={e => setNewForm(f => ({ ...f, promotionIntensity: e.target.value as 'subtle' | 'moderate' | 'direct' }))}>
                  <option value="subtle">Subtle</option>
                  <option value="moderate">Moderate</option>
                  <option value="direct">Direct</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Keywords (comma-separated)</label>
              <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={newForm.keywords.join(', ')} onChange={e => setNewForm(f => ({ ...f, keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} placeholder="e.g. highlights, export, ebook" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Subreddits (comma-separated, without r/)</label>
              <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={newForm.subreddits.join(', ')} onChange={e => setNewForm(f => ({ ...f, subreddits: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} placeholder="e.g. kobo, ereader, kindle" />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating...' : 'Create Product'}
              </Button>
              <Button variant="outline" onClick={() => { setShowNew(false); setError('') }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {products.map(p => (
        <Card key={p.id}>
          <CardContent className="pt-6">
            <ProductForm
              product={p}
              onSave={() => load()}
            />
          </CardContent>
        </Card>
      ))}
      {products.length === 0 && !showNew && (
        <p className="text-muted-foreground">
          No products configured. Click &quot;Add Product&quot; to get started.
        </p>
      )}
    </div>
  )
}
