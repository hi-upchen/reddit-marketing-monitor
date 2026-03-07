# Reddit Marketing Monitor — Implementation Plan

**Goal:** Build a personal web app that scans Reddit for posts relevant to two indie products (Kobo Note Up, txtconv), scores them with AI, drafts reply suggestions, and lets the creator manually approve and post them.

**Architecture:** Next.js app with API routes for backend logic. Supabase (PostgreSQL) for persistent storage. Reddit OAuth2 via snoowrap for fetching posts and posting comments. Claude API for relevance scoring and reply drafting. node-cron for scheduled scans.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Supabase (PostgreSQL + Auth), Drizzle ORM, snoowrap, Anthropic SDK, node-cron, Resend (email), shadcn/ui components

**Design Decisions:**
- Same Reddit post matching keywords from two different products → two separate rows in `reddit_posts`, each with its own `product_id`
- Database: Supabase (avoids Vercel ephemeral filesystem issue with SQLite)
- Auth: simple env-var password gate (single owner, no need for full auth system)
- Deployment target: Vercel (with Supabase for DB)

---

## Prerequisites

Before starting any task, ensure you have:
- Node.js 20+, npm/pnpm
- A Supabase account (free tier) with a new project created
- A Reddit account + app registered at https://www.reddit.com/prefs/apps (type: web app)
- An Anthropic API key
- A Resend account (free tier) for email

Environment variables needed (create `.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_REDIRECT_URI=http://localhost:3000/api/auth/reddit/callback
ANTHROPIC_API_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
NOTIFICATION_EMAIL=
APP_PASSWORD=   # simple password to gate the dashboard
ENCRYPTION_KEY= # 32-char random string for token encryption
```

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`
- Create: `.env.local`, `.env.example`, `.gitignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`

**Step 1: Bootstrap Next.js project**

```bash
npx create-next-app@latest reddit-marketing-monitor \
  --typescript --tailwind --app --src-dir --import-alias "@/*"
cd reddit-marketing-monitor
```

**Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js drizzle-orm drizzle-kit pg \
  snoowrap @anthropic-ai/sdk resend node-cron \
  crypto-js @types/crypto-js @types/node-cron \
  lucide-react class-variance-authority clsx tailwind-merge
npm install -D @types/snoowrap
npx shadcn@latest init
npx shadcn@latest add button card badge input textarea select tabs dialog toast
```

**Step 3: Create `.env.example`**

Copy the env vars from Prerequisites above (without values) into `.env.example`. Fill in real values in `.env.local`.

**Step 4: Verify dev server starts**

```bash
npm run dev
```
Expected: App runs at http://localhost:3000 with default Next.js page.

**Step 5: Commit**

```bash
git init
git add .
git commit -m "feat: initial Next.js project setup"
```

---

## Task 2: Database Schema (Supabase)

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`
- Create: `drizzle.config.ts`
- Create: `src/db/migrations/` (auto-generated)

**Step 1: Create Drizzle config**

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.SUPABASE_DB_URL!, // get from Supabase → Settings → Database → Connection string (URI mode)
  },
})
```

**Step 2: Create schema**

```typescript
// src/db/schema.ts
import { pgTable, uuid, text, integer, boolean, timestamp, pgEnum, json, unique } from 'drizzle-orm/pg-core'

export const promotionIntensityEnum = pgEnum('promotion_intensity', ['subtle', 'moderate', 'direct'])
export const relevanceTierEnum = pgEnum('relevance_tier', ['high', 'medium', 'low'])
export const postStatusEnum = pgEnum('post_status', ['new', 'draft', 'approved', 'posted', 'skipped', 'bookmarked'])

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  description: text('description').notNull(),
  problemsSolved: text('problems_solved').notNull(),
  features: text('features').notNull(),
  targetAudience: text('target_audience').notNull(),
  replyTone: text('reply_tone').notNull().default('helpful and friendly'),
  promotionIntensity: promotionIntensityEnum('promotion_intensity').notNull().default('moderate'),
  keywords: json('keywords').$type<string[]>().notNull().default([]),
  subreddits: json('subreddits').$type<string[]>().notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const redditPosts = pgTable('reddit_posts', {
  id: uuid('id').defaultRandom().primaryKey(),
  redditPostId: text('reddit_post_id').notNull(),
  productId: uuid('product_id').notNull().references(() => products.id),
  subreddit: text('subreddit').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  author: text('author').notNull(),
  score: integer('score').notNull().default(0),
  commentCount: integer('comment_count').notNull().default(0),
  url: text('url').notNull(),
  matchedKeywords: json('matched_keywords').$type<string[]>().notNull().default([]),
  relevanceScore: integer('relevance_score').notNull().default(0),
  relevanceTier: relevanceTierEnum('relevance_tier').notNull().default('low'),
  relevanceReason: text('relevance_reason').notNull().default(''),
  status: postStatusEnum('status').notNull().default('new'),
  redditCreatedAt: timestamp('reddit_created_at').notNull(),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
}, (table) => ({
  // One Reddit post can appear once per product (two products = two rows max)
  uniquePostPerProduct: unique().on(table.redditPostId, table.productId),
}))

export const replyDrafts = pgTable('reply_drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  postId: uuid('post_id').notNull().references(() => redditPosts.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  body: text('body').notNull(),
  version: integer('version').notNull().default(1),
  isApproved: boolean('is_approved').notNull().default(false),
  isPosted: boolean('is_posted').notNull().default(false),
  approvedAt: timestamp('approved_at'),
  postedAt: timestamp('posted_at'),
  redditCommentId: text('reddit_comment_id'),
  redditCommentUrl: text('reddit_comment_url'),
  commentScore: integer('comment_score'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const appSettings = pgTable('app_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const scanLogs = pgTable('scan_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  triggeredBy: text('triggered_by').notNull().default('scheduled'), // 'manual' | 'scheduled'
  status: text('status').notNull().default('running'), // 'running' | 'completed' | 'failed'
  postsFound: integer('posts_found').notNull().default(0),
  newPosts: integer('new_posts').notNull().default(0),
  claudeCalls: integer('claude_calls').notNull().default(0),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
})
```

**Step 3: Create DB client**

```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

export const db = drizzle(pool, { schema })
export * from './schema'
```

**Step 4: Generate and run migration**

```bash
# Add SUPABASE_DB_URL to .env.local first (from Supabase → Settings → Database → URI)
npx drizzle-kit generate
npx drizzle-kit migrate
```
Expected: Migration files created in `src/db/migrations/`. Tables created in Supabase.

**Step 5: Verify in Supabase dashboard**

Open Supabase → Table Editor. Confirm all 5 tables exist: `products`, `reddit_posts`, `reply_drafts`, `app_settings`, `scan_logs`.

**Step 6: Commit**

```bash
git add .
git commit -m "feat: database schema with Drizzle + Supabase"
```

---

## Task 3: Auth — Simple Password Gate

**Files:**
- Create: `src/middleware.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/lib/auth.ts`

**Step 1: Create auth helper**

```typescript
// src/lib/auth.ts
import { cookies } from 'next/headers'

const SESSION_COOKIE = 'rmm_session'
const SESSION_VALUE = 'authenticated'

export function isAuthenticated(): boolean {
  const cookieStore = cookies()
  return cookieStore.get(SESSION_COOKIE)?.value === SESSION_VALUE
}

export function getPassword(): string {
  const pw = process.env.APP_PASSWORD
  if (!pw) throw new Error('APP_PASSWORD env var not set')
  return pw
}
```

**Step 2: Create login API route**

```typescript
// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getPassword } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { password } = await req.json()
  if (password !== getPassword()) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set('rmm_session', 'authenticated', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
  return res
}
```

**Step 3: Create logout route**

```typescript
// src/app/api/auth/logout/route.ts
import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('rmm_session')
  return res
}
```

**Step 4: Create middleware**

```typescript
// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isPublic = pathname.startsWith('/login') || pathname.startsWith('/api/auth')
  const session = req.cookies.get('rmm_session')?.value

  if (!isPublic && session !== 'authenticated') {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

**Step 5: Create login page**

```tsx
// src/app/login/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      router.push('/')
    } else {
      setError('Wrong password')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reddit Marketing Monitor</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full">Sign In</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 6: Test auth flow manually**

1. Visit http://localhost:3000 — should redirect to /login
2. Enter wrong password — should show "Wrong password"
3. Enter correct `APP_PASSWORD` — should redirect to /
4. Revisit http://localhost:3000 — should stay on /

**Step 7: Commit**

```bash
git add .
git commit -m "feat: simple password gate auth"
```

---

## Task 4: Reddit OAuth Integration

**Files:**
- Create: `src/lib/reddit-auth.ts`
- Create: `src/lib/encrypt.ts`
- Create: `src/app/api/auth/reddit/connect/route.ts`
- Create: `src/app/api/auth/reddit/callback/route.ts`
- Create: `src/app/api/auth/reddit/disconnect/route.ts`
- Create: `src/app/api/auth/reddit/status/route.ts`

**Step 1: Create encryption helper**

```typescript
// src/lib/encrypt.ts
import CryptoJS from 'crypto-js'

const KEY = process.env.ENCRYPTION_KEY!

export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, KEY).toString()
}

export function decrypt(ciphertext: string): string {
  return CryptoJS.AES.decrypt(ciphertext, KEY).toString(CryptoJS.enc.Utf8)
}
```

**Step 2: Create Reddit auth helpers**

```typescript
// src/lib/reddit-auth.ts
import { db } from '@/db'
import { appSettings } from '@/db/schema'
import { encrypt, decrypt } from './encrypt'
import { eq } from 'drizzle-orm'

const REDDIT_TOKEN_KEY = 'reddit_token'
const REDDIT_AUTH_URL = 'https://www.reddit.com/api/v1/authorize'
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'

export interface RedditTokenData {
  accessToken: string
  refreshToken: string
  expiresAt: number // unix ms
  username: string
}

export function getRedditAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.REDDIT_CLIENT_ID!,
    response_type: 'code',
    state,
    redirect_uri: process.env.REDDIT_REDIRECT_URI!,
    duration: 'permanent',
    scope: 'identity submit history read',
  })
  return `${REDDIT_AUTH_URL}?${params}`
}

export async function exchangeCodeForToken(code: string): Promise<RedditTokenData> {
  const credentials = Buffer.from(
    `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'RedditMarketingMonitor/1.0',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.REDDIT_REDIRECT_URI!,
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Reddit OAuth error: ${data.error}`)

  // Fetch username
  const meRes = await fetch('https://oauth.reddit.com/api/v1/me', {
    headers: {
      Authorization: `Bearer ${data.access_token}`,
      'User-Agent': 'RedditMarketingMonitor/1.0',
    },
  })
  const me = await meRes.json()

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    username: me.name,
  }
}

export async function refreshAccessToken(tokenData: RedditTokenData): Promise<RedditTokenData> {
  const credentials = Buffer.from(
    `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'RedditMarketingMonitor/1.0',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenData.refreshToken,
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Token refresh failed: ${data.error}`)

  return {
    ...tokenData,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

export async function saveToken(tokenData: RedditTokenData): Promise<void> {
  const encrypted = encrypt(JSON.stringify(tokenData))
  await db.insert(appSettings)
    .values({ key: REDDIT_TOKEN_KEY, value: encrypted })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: encrypted, updatedAt: new Date() } })
}

export async function getToken(): Promise<RedditTokenData | null> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, REDDIT_TOKEN_KEY))
  if (!rows.length) return null
  const tokenData: RedditTokenData = JSON.parse(decrypt(rows[0].value))

  // Auto-refresh if expired
  if (Date.now() > tokenData.expiresAt - 60_000) {
    const refreshed = await refreshAccessToken(tokenData)
    await saveToken(refreshed)
    return refreshed
  }
  return tokenData
}

export async function deleteToken(): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, REDDIT_TOKEN_KEY))
}
```

**Step 3: Create OAuth API routes**

```typescript
// src/app/api/auth/reddit/connect/route.ts
import { NextResponse } from 'next/server'
import { getRedditAuthUrl } from '@/lib/reddit-auth'
import crypto from 'crypto'

export async function GET() {
  const state = crypto.randomBytes(16).toString('hex')
  const url = getRedditAuthUrl(state)
  const res = NextResponse.redirect(url)
  res.cookies.set('reddit_oauth_state', state, { httpOnly: true, maxAge: 300 })
  return res
}
```

```typescript
// src/app/api/auth/reddit/callback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForToken, saveToken } from '@/lib/reddit-auth'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const storedState = req.cookies.get('reddit_oauth_state')?.value

  if (!code || state !== storedState) {
    return NextResponse.redirect(new URL('/settings/reddit?error=oauth_failed', req.url))
  }

  try {
    const tokenData = await exchangeCodeForToken(code)
    await saveToken(tokenData)
    return NextResponse.redirect(new URL('/settings/reddit?connected=true', req.url))
  } catch (e) {
    console.error('Reddit OAuth callback error:', e)
    return NextResponse.redirect(new URL('/settings/reddit?error=token_exchange_failed', req.url))
  }
}
```

```typescript
// src/app/api/auth/reddit/disconnect/route.ts
import { NextResponse } from 'next/server'
import { deleteToken } from '@/lib/reddit-auth'

export async function POST() {
  await deleteToken()
  return NextResponse.json({ ok: true })
}
```

```typescript
// src/app/api/auth/reddit/status/route.ts
import { NextResponse } from 'next/server'
import { getToken } from '@/lib/reddit-auth'

export async function GET() {
  const token = await getToken()
  return NextResponse.json({
    connected: !!token,
    username: token?.username ?? null,
  })
}
```

**Step 4: Commit**

```bash
git add .
git commit -m "feat: Reddit OAuth2 connect/disconnect flow"
```

---

## Task 5: Product Configuration API & Seed Data

**Files:**
- Create: `src/app/api/products/route.ts`
- Create: `src/app/api/products/[id]/route.ts`
- Create: `src/db/seed.ts`

**Step 1: Products CRUD API**

```typescript
// src/app/api/products/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db, products } from '@/db'

export async function GET() {
  const rows = await db.select().from(products).orderBy(products.createdAt)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const [row] = await db.insert(products).values(body).returning()
  return NextResponse.json(row, { status: 201 })
}
```

```typescript
// src/app/api/products/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db, products } from '@/db'
import { eq } from 'drizzle-orm'

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const [row] = await db.select().from(products).where(eq(products.id, params.id))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()
  const [row] = await db.update(products).set(body).where(eq(products.id, params.id)).returning()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}
```

**Step 2: Seed script with both products**

```typescript
// src/db/seed.ts
import { db, products } from './index'

async function seed() {
  await db.insert(products).values([
    {
      name: 'Kobo Note Up',
      url: 'https://kobo-up.runawayup.com/',
      description: 'Browser-based tool to export Kobo e-reader highlights, notes, and stylus handwriting annotations. 100% local (WebAssembly), no server, no data upload.',
      problemsSolved: "Kobo's official export randomly fails, ignores sideloaded books, truncates long highlights, doesn't export stylus annotations",
      features: 'Auto-detects KoboReader.sqlite, supports sideloaded books, exports highlight colors, stylus ink annotations, Markdown and plain text export',
      targetAudience: 'Kobo e-reader owners who want to export highlights to Obsidian, Notion, Markdown, or plain text',
      replyTone: 'helpful and friendly, casual indie maker',
      promotionIntensity: 'moderate',
      keywords: [
        'kobo highlights export', 'kobo notes export', 'kobo export not working',
        'kobo sideloaded books', 'kobo obsidian', 'kobo stylus annotations',
        'export ebook highlights',
      ],
      subreddits: [
        'kobo', 'ObsidianMD', 'Notion', 'ebooks', 'kindle',
        'productivity', 'readingandwriting', 'selfhosted',
      ],
      isActive: true,
    },
    {
      name: 'txtconv',
      url: 'https://txtconv.arpuli.com/',
      description: 'Online Simplified Chinese to Traditional Chinese converter for plain text files, subtitles (SRT), CSV, and XML. Supports batch conversion and custom dictionary overrides.',
      problemsSolved: 'Existing converters are inaccurate for domain-specific vocabulary (tech, media, fiction); no support for file batch conversion; poor support for subtitle formats',
      features: 'Supports .txt, .srt, .csv, .xml; custom dictionary with up to 10,000 entries; batch file conversion; browser-based',
      targetAudience: 'Chinese readers, subtitle editors, bloggers converting Simplified Chinese novels, subtitles, or documents to Traditional Chinese (Taiwan/Hong Kong)',
      replyTone: 'helpful and friendly',
      promotionIntensity: 'moderate',
      keywords: [
        'simplified to traditional chinese', '簡繁轉換', 'srt subtitle converter',
        'chinese text converter', 'kobo chinese ebook',
      ],
      subreddits: [
        'ChineseLanguage', 'translator', 'kdrama', 'anime', 'learnChinese',
        'hongkong', 'taiwan',
      ],
      isActive: true,
    },
  ]).onConflictDoNothing()

  console.log('Seeded products')
  process.exit(0)
}

seed().catch(console.error)
```

**Step 3: Add seed script to package.json**

```json
// In package.json, add to "scripts":
"db:seed": "npx tsx src/db/seed.ts"
```

**Step 4: Run seed**

```bash
npm run db:seed
```
Expected: "Seeded products" printed. Two rows appear in Supabase `products` table.

**Step 5: Commit**

```bash
git add .
git commit -m "feat: products CRUD API and seed data"
```

---

## Task 6: Product Configuration UI

**Files:**
- Create: `src/app/settings/products/page.tsx`
- Create: `src/components/ProductForm.tsx`
- Create: `src/components/TagInput.tsx`
- Create: `src/app/settings/layout.tsx`

**Step 1: Create reusable TagInput component**

```tsx
// src/components/TagInput.tsx
'use client'
import { useState, KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

export function TagInput({ value, onChange, placeholder }: TagInputProps) {
  const [input, setInput] = useState('')

  function addTag() {
    const tag = input.trim().toLowerCase()
    if (tag && !value.includes(tag)) {
      onChange([...value, tag])
    }
    setInput('')
  }

  function removeTag(tag: string) {
    onChange(value.filter(t => t !== tag))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    }
    if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1])
    }
  }

  return (
    <div className="border rounded-md p-2 space-y-2">
      <div className="flex flex-wrap gap-1">
        {value.map(tag => (
          <Badge key={tag} variant="secondary" className="gap-1">
            {tag}
            <button onClick={() => removeTag(tag)} className="hover:text-destructive">
              <X size={12} />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={placeholder ?? 'Type and press Enter'}
        className="border-0 p-0 h-auto focus-visible:ring-0"
      />
    </div>
  )
}
```

**Step 2: Create ProductForm component**

```tsx
// src/components/ProductForm.tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { TagInput } from './TagInput'

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

export function ProductForm({ product, onSave }: { product: Product; onSave: () => void }) {
  const [form, setForm] = useState(product)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(field: keyof Product, value: unknown) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    if (!form.name || !form.url || !form.description) {
      setError('Name, URL, and description are required')
      return
    }
    if (!form.url.startsWith('http')) {
      setError('URL must start with http:// or https://')
      return
    }
    setSaving(true)
    setError('')
    const res = await fetch(`/api/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (res.ok) onSave()
    else setError('Failed to save')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{form.name}</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Active</span>
          <Switch checked={form.isActive} onCheckedChange={v => set('isActive', v)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>Product Name</Label>
          <Input value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>URL</Label>
          <Input value={form.url} onChange={e => set('url', e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Description (for AI context)</Label>
        <Textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} />
      </div>

      <div className="space-y-1">
        <Label>Problems Solved</Label>
        <Textarea value={form.problemsSolved} onChange={e => set('problemsSolved', e.target.value)} rows={2} />
      </div>

      <div className="space-y-1">
        <Label>Key Features</Label>
        <Textarea value={form.features} onChange={e => set('features', e.target.value)} rows={2} />
      </div>

      <div className="space-y-1">
        <Label>Target Audience</Label>
        <Input value={form.targetAudience} onChange={e => set('targetAudience', e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>Reply Tone</Label>
          <Input value={form.replyTone} onChange={e => set('replyTone', e.target.value)} placeholder="e.g. helpful and friendly" />
        </div>
        <div className="space-y-1">
          <Label>Promotion Intensity</Label>
          <Select value={form.promotionIntensity} onValueChange={v => set('promotionIntensity', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="subtle">Subtle</SelectItem>
              <SelectItem value="moderate">Moderate</SelectItem>
              <SelectItem value="direct">Direct</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label>Keywords (press Enter to add)</Label>
        <TagInput value={form.keywords} onChange={v => set('keywords', v)} placeholder="e.g. kobo highlights export" />
      </div>

      <div className="space-y-1">
        <Label>Subreddits (without r/, press Enter to add)</Label>
        <TagInput value={form.subreddits} onChange={v => set('subreddits', v)} placeholder="e.g. kobo" />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  )
}
```

**Step 3: Create settings products page**

```tsx
// src/app/settings/products/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { ProductForm } from '@/components/ProductForm'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'

export default function ProductsSettingsPage() {
  const [products, setProducts] = useState<any[]>([])
  const { toast } = useToast()

  async function load() {
    const res = await fetch('/api/products')
    setProducts(await res.json())
  }

  useEffect(() => { load() }, [])

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <h1 className="text-2xl font-bold">Product Configuration</h1>
      {products.map(p => (
        <Card key={p.id}>
          <CardContent className="pt-6">
            <ProductForm
              product={p}
              onSave={() => {
                toast({ title: 'Saved', description: `${p.name} updated` })
                load()
              }}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

**Step 4: Test manually**

1. Visit http://localhost:3000/settings/products
2. Both product cards should appear with pre-filled data from seed
3. Change a keyword → save → reload → keyword persists
4. Clear the name field → save → error shown, not saved

**Step 5: Commit**

```bash
git add .
git commit -m "feat: product configuration UI"
```

---

## Task 7: Reddit Scanning Engine

**Files:**
- Create: `src/lib/scanner.ts`
- Create: `src/app/api/scan/route.ts`
- Create: `src/app/api/scan/history/route.ts`

**Step 1: Create scanner library**

```typescript
// src/lib/scanner.ts
import { db, products, redditPosts, scanLogs } from '@/db'
import { eq, and } from 'drizzle-orm'
import { getToken } from './reddit-auth'
import { scorePostRelevance } from './ai'

interface RedditPost {
  id: string
  title: string
  selftext: string
  author: string
  score: number
  num_comments: number
  url: string
  subreddit: string
  created_utc: number
  permalink: string
}

const REDDIT_SEARCH_URL = 'https://oauth.reddit.com'
const USER_AGENT = 'RedditMarketingMonitor/1.0'
const DELAY_MS = 1200 // ~50 req/min to stay well under 100/min limit
const MAX_BODY_CHARS = 2000 // truncate before sending to Claude
const DAYS_BACK = 7

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function searchReddit(
  token: string,
  keyword: string,
  subreddit: string | null,
  after: number
): Promise<RedditPost[]> {
  const timeParam = 'week'
  let url: string

  if (subreddit) {
    url = `${REDDIT_SEARCH_URL}/r/${subreddit}/search.json?q=${encodeURIComponent(keyword)}&restrict_sr=on&sort=new&t=${timeParam}&limit=25`
  } else {
    url = `${REDDIT_SEARCH_URL}/search.json?q=${encodeURIComponent(keyword)}&sort=new&t=${timeParam}&limit=25`
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
  })

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
    console.log(`Rate limited. Waiting ${retryAfter}s...`)
    await sleep(retryAfter * 1000)
    return searchReddit(token, keyword, subreddit, after)
  }

  if (!res.ok) throw new Error(`Reddit search failed: ${res.status}`)

  const data = await res.json()
  const cutoff = Date.now() / 1000 - DAYS_BACK * 86400

  return (data.data?.children ?? [])
    .map((c: { data: RedditPost }) => c.data)
    .filter((p: RedditPost) => p.created_utc > cutoff)
}

export async function runScan(triggeredBy: 'manual' | 'scheduled' = 'manual') {
  // Check if a scan is already running
  const running = await db.select().from(scanLogs)
    .where(eq(scanLogs.status, 'running'))
  if (running.length > 0) {
    throw new Error('A scan is already in progress')
  }

  const [log] = await db.insert(scanLogs)
    .values({ triggeredBy, status: 'running' })
    .returning()

  const updateLog = (data: Partial<typeof scanLogs.$inferInsert>) =>
    db.update(scanLogs).set({ ...data, completedAt: new Date() }).where(eq(scanLogs.id, log.id))

  try {
    const token = await getToken()
    if (!token) throw new Error('Reddit not connected')

    const activeProducts = await db.select().from(products).where(eq(products.isActive, true))
    if (!activeProducts.length) {
      await updateLog({ status: 'completed', postsFound: 0, newPosts: 0, claudeCalls: 0 })
      return { postsFound: 0, newPosts: 0 }
    }

    let totalFound = 0
    let totalNew = 0
    let totalClaudeCalls = 0

    for (const product of activeProducts) {
      const keywords = product.keywords as string[]
      const subreddits = product.subreddits as string[]

      // Collect unique posts per product (deduplicate by reddit post ID within this product)
      const seenInThisScan = new Map<string, { post: RedditPost; matchedKeywords: string[] }>()

      for (const keyword of keywords) {
        const searchTargets = subreddits.length > 0 ? subreddits : [null]

        for (const sub of searchTargets) {
          try {
            const posts = await searchReddit(token.accessToken, keyword, sub, 0)
            totalFound += posts.length

            for (const post of posts) {
              if (seenInThisScan.has(post.id)) {
                seenInThisScan.get(post.id)!.matchedKeywords.push(keyword)
              } else {
                seenInThisScan.set(post.id, { post, matchedKeywords: [keyword] })
              }
            }
          } catch (e) {
            console.error(`Search error for keyword "${keyword}" in ${sub ?? 'all'}:`, e)
          }
          await sleep(DELAY_MS)
        }
      }

      // Insert new posts and score them
      for (const [redditPostId, { post, matchedKeywords }] of seenInThisScan) {
        // Check if this (post, product) combo already exists
        const existing = await db.select({ id: redditPosts.id })
          .from(redditPosts)
          .where(and(
            eq(redditPosts.redditPostId, redditPostId),
            eq(redditPosts.productId, product.id)
          ))

        if (existing.length > 0) continue // Already in DB for this product

        const body = (post.selftext ?? '').slice(0, MAX_BODY_CHARS)

        // AI relevance scoring
        let relevanceScore = 0
        let relevanceTier: 'high' | 'medium' | 'low' = 'low'
        let relevanceReason = 'Scoring unavailable'

        try {
          const scored = await scorePostRelevance(product, post.title, body)
          relevanceScore = scored.score
          relevanceTier = scored.tier
          relevanceReason = scored.reason
          totalClaudeCalls++
        } catch (e) {
          console.error(`AI scoring failed for post ${redditPostId}:`, e)
        }

        await db.insert(redditPosts).values({
          redditPostId,
          productId: product.id,
          subreddit: post.subreddit,
          title: post.title,
          body,
          author: post.author,
          score: post.score,
          commentCount: post.num_comments,
          url: `https://reddit.com${post.permalink}`,
          matchedKeywords,
          relevanceScore,
          relevanceTier,
          relevanceReason,
          status: 'new',
          redditCreatedAt: new Date(post.created_utc * 1000),
        })

        totalNew++
      }
    }

    await updateLog({
      status: 'completed',
      postsFound: totalFound,
      newPosts: totalNew,
      claudeCalls: totalClaudeCalls,
    })

    return { postsFound: totalFound, newPosts: totalNew }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    await db.update(scanLogs).set({
      status: 'failed',
      errorMessage: message,
      completedAt: new Date(),
    }).where(eq(scanLogs.id, log.id))
    throw e
  }
}
```

**Step 2: Create AI scoring function (placeholder — will expand in Task 8)**

```typescript
// src/lib/ai.ts
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

interface ScoringResult {
  score: number
  tier: 'high' | 'medium' | 'low'
  reason: string
}

export async function scorePostRelevance(
  product: { name: string; description: string; problemsSolved: string; features: string },
  title: string,
  body: string
): Promise<ScoringResult> {
  const prompt = `You are evaluating Reddit posts for relevance to a product.

Product: ${product.name}
Description: ${product.description}
Problems it solves: ${product.problemsSolved}
Features: ${product.features}

Reddit post:
Title: ${title}
Body: ${body.slice(0, 1500)}

Rate this post's relevance 1-10 for whether a reply mentioning this product would be:
- Welcome and helpful (not spammy)
- The post author is clearly experiencing a problem this product solves
- The subreddit context makes it appropriate

Respond in this exact JSON format (nothing else):
{"score": 7, "reason": "One sentence explaining the relevance score"}`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const parsed = JSON.parse(text)
  const score = Math.max(1, Math.min(10, parseInt(parsed.score)))
  const tier = score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low'

  return { score, tier, reason: parsed.reason }
}
```

**Step 3: Create scan API route**

```typescript
// src/app/api/scan/route.ts
import { NextResponse } from 'next/server'
import { runScan } from '@/lib/scanner'

export async function POST() {
  try {
    const result = await runScan('manual')
    return NextResponse.json(result)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Scan failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

```typescript
// src/app/api/scan/history/route.ts
import { NextResponse } from 'next/server'
import { db, scanLogs } from '@/db'
import { desc } from 'drizzle-orm'

export async function GET() {
  const logs = await db.select().from(scanLogs).orderBy(desc(scanLogs.startedAt)).limit(50)
  return NextResponse.json(logs)
}
```

**Step 4: Test the scanner**

```bash
# In a second terminal, while dev server is running:
curl -X POST http://localhost:3000/api/scan \
  -H "Cookie: rmm_session=authenticated"
```
Expected: JSON with `postsFound` and `newPosts` counts. Check Supabase `reddit_posts` table for rows.

**Step 5: Test deduplication**

```bash
# Run scan twice
curl -X POST http://localhost:3000/api/scan -H "Cookie: rmm_session=authenticated"
curl -X POST http://localhost:3000/api/scan -H "Cookie: rmm_session=authenticated"
```
Expected: Second scan result shows `newPosts: 0` (all already in DB).

**Step 6: Commit**

```bash
git add .
git commit -m "feat: Reddit scanning engine with AI relevance scoring"
```

---

## Task 8: Post Queue Dashboard

**Files:**
- Create: `src/app/page.tsx` (dashboard)
- Create: `src/app/api/posts/route.ts`
- Create: `src/app/api/posts/[id]/route.ts`
- Create: `src/components/PostCard.tsx`
- Create: `src/components/QueueFilters.tsx`
- Create: `src/components/AppNav.tsx`
- Create: `src/app/scan/page.tsx`

**Step 1: Posts API**

```typescript
// src/app/api/posts/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db, redditPosts, products } from '@/db'
import { eq, and, desc, inArray } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const productId = searchParams.get('productId')
  const tier = searchParams.get('tier')
  const status = searchParams.get('status') ?? 'new,draft,approved,bookmarked'
  const statuses = status.split(',')

  const conditions = []
  if (productId) conditions.push(eq(redditPosts.productId, productId))
  if (tier) conditions.push(eq(redditPosts.relevanceTier, tier as 'high' | 'medium' | 'low'))
  if (statuses.length) conditions.push(inArray(redditPosts.status, statuses as ('new' | 'draft' | 'approved' | 'posted' | 'skipped' | 'bookmarked')[]))

  const rows = await db
    .select({ post: redditPosts, product: { id: products.id, name: products.name } })
    .from(redditPosts)
    .leftJoin(products, eq(redditPosts.productId, products.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(redditPosts.relevanceScore), desc(redditPosts.fetchedAt))
    .limit(100)

  return NextResponse.json(rows)
}
```

```typescript
// src/app/api/posts/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db, redditPosts } from '@/db'
import { eq } from 'drizzle-orm'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()
  const [row] = await db.update(redditPosts)
    .set(body)
    .where(eq(redditPosts.id, params.id))
    .returning()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}
```

**Step 2: PostCard component**

```tsx
// src/components/PostCard.tsx
'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ExternalLink, BookmarkIcon, SkipForward, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react'

const TIER_COLORS = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-600',
}

export function PostCard({ post, productName, onAction }: {
  post: any
  productName: string
  onAction: (id: string, action: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [undoing, setUndoing] = useState(false)

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime()
    const h = Math.floor(diff / 3600000)
    const d = Math.floor(h / 24)
    return d > 0 ? `${d}d ago` : h > 0 ? `${h}h ago` : 'just now'
  }

  async function handleSkip() {
    await onAction(post.id, 'skipped')
    setUndoing(true)
    setTimeout(() => setUndoing(false), 6000)
  }

  return (
    <Card className="relative">
      <CardContent className="pt-4 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <Badge variant="outline">r/{post.subreddit}</Badge>
          <Badge variant="secondary">{productName}</Badge>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIER_COLORS[post.relevanceTier as keyof typeof TIER_COLORS]}`}>
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
          <ExternalLink size={14} className="text-muted-foreground" />
        </a>

        <p className="text-sm text-muted-foreground">
          {expanded ? post.body : post.body?.slice(0, 200)}
          {post.body?.length > 200 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="ml-1 text-primary hover:underline inline-flex items-center gap-0.5"
            >
              {expanded ? <><ChevronUp size={12} /> less</> : <><ChevronDown size={12} /> more</>}
            </button>
          )}
        </p>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>u/{post.author}</span>
          <span>↑ {post.score}</span>
          <span>💬 {post.commentCount}</span>
          <span>{timeAgo(post.redditCreatedAt)}</span>
          <span>matched: {(post.matchedKeywords as string[]).join(', ')}</span>
        </div>

        {post.relevanceReason && (
          <p className="text-xs italic text-muted-foreground border-l-2 pl-2">
            {post.relevanceReason}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={() => window.location.href = `/reply/${post.id}`}>
            <MessageSquare size={14} className="mr-1" /> Draft Reply
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAction(post.id, 'bookmarked')}>
            <BookmarkIcon size={14} className="mr-1" /> Bookmark
          </Button>
          <Button size="sm" variant="ghost" onClick={handleSkip}>
            <SkipForward size={14} className="mr-1" /> Skip
          </Button>
        </div>

        {undoing && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            Post skipped.
            <button
              className="text-primary underline"
              onClick={() => { onAction(post.id, 'new'); setUndoing(false) }}
            >
              Undo
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Step 3: Dashboard page**

```tsx
// src/app/page.tsx
'use client'
import { useEffect, useState, useCallback } from 'react'
import { PostCard } from '@/components/PostCard'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RefreshCw } from 'lucide-react'

export default function DashboardPage() {
  const [posts, setPosts] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [scanning, setScanning] = useState(false)
  const [productFilter, setProductFilter] = useState('all')
  const [tierFilter, setTierFilter] = useState('high,medium')
  const [lastScanned, setLastScanned] = useState<string | null>(null)

  const loadPosts = useCallback(async () => {
    const params = new URLSearchParams()
    if (productFilter !== 'all') params.set('productId', productFilter)
    if (tierFilter !== 'all') {
      // Pass each tier separately if filtering
    }
    const res = await fetch(`/api/posts?${params}`)
    const data = await res.json()
    // Filter tiers client-side for simplicity
    const filtered = tierFilter === 'all'
      ? data
      : data.filter((r: any) => tierFilter.split(',').includes(r.post.relevanceTier))
    setPosts(filtered)
  }, [productFilter, tierFilter])

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(setProducts)
    loadPosts()
  }, [loadPosts])

  async function handleScanNow() {
    setScanning(true)
    await fetch('/api/scan', { method: 'POST' })
    setScanning(false)
    setLastScanned(new Date().toLocaleTimeString())
    loadPosts()
  }

  async function handleAction(id: string, status: string) {
    await fetch(`/api/posts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    loadPosts()
  }

  const productMap = Object.fromEntries(products.map((p: any) => [p.id, p.name]))

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Post Queue</h1>
        <div className="flex items-center gap-2">
          {lastScanned && <span className="text-sm text-muted-foreground">Last scan: {lastScanned}</span>}
          <Button onClick={handleScanNow} disabled={scanning} size="sm">
            <RefreshCw size={14} className={`mr-1 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Scan Now'}
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <Select value={productFilter} onValueChange={setProductFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Products" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Relevance" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="high,medium">High + Medium</SelectItem>
            <SelectItem value="high">High only</SelectItem>
            <SelectItem value="medium">Medium only</SelectItem>
            <SelectItem value="all">All (incl. Low)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">{posts.length} posts</p>

      <div className="space-y-3">
        {posts.map((r: any) => (
          <PostCard
            key={r.post.id}
            post={r.post}
            productName={productMap[r.post.productId] ?? ''}
            onAction={handleAction}
          />
        ))}
        {posts.length === 0 && (
          <p className="text-center text-muted-foreground py-12">
            No posts found. Run a scan to get started.
          </p>
        )}
      </div>
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add .
git commit -m "feat: post queue dashboard with filters and actions"
```

---

## Task 9: Reply Editor — AI Draft Generation & Approval

**Files:**
- Create: `src/app/reply/[postId]/page.tsx`
- Create: `src/app/api/posts/[id]/draft/route.ts`
- Create: `src/app/api/posts/[id]/approve/route.ts`
- Create: `src/app/api/posts/[id]/post/route.ts`
- Modify: `src/lib/ai.ts` (add `generateReplyDraft`)

**Step 1: Add reply generation to ai.ts**

```typescript
// Add to src/lib/ai.ts

function appendUtm(url: string, subreddit: string, campaign: string): string {
  const utmParams = `utm_source=reddit&utm_medium=comment&utm_campaign=${campaign}&utm_content=${subreddit}`
  return url.includes('?') ? `${url}&${utmParams}` : `${url}?${utmParams}`
}

export async function generateReplyDraft(
  product: {
    name: string; url: string; description: string; problemsSolved: string
    features: string; targetAudience: string; replyTone: string; promotionIntensity: string
  },
  post: { title: string; body: string; subreddit: string },
  tone: string = 'default'
): Promise<string> {
  const campaign = product.name.toLowerCase().replace(/\s+/g, '-')
  const utmUrl = appendUtm(product.url, post.subreddit, campaign)

  const toneInstructions: Record<string, string> = {
    helpful: 'Be warm and directly helpful. Focus on solving their problem.',
    technical: 'Use precise technical language. Be concise and factual.',
    'personal story': 'Write as if sharing a personal experience or discovery.',
    minimal: 'Keep it to 2-3 sentences. Very brief and to the point.',
    default: '',
  }

  const extraTone = toneInstructions[tone.toLowerCase()] ?? ''

  const systemPrompt = `You are helping the creator of "${product.name}" respond to Reddit posts in a genuine, helpful, non-spammy way.

Product: ${product.name}
URL: ${utmUrl}
Description: ${product.description}
Problems it solves: ${product.problemsSolved}
Key features: ${product.features}
Target audience: ${product.targetAudience}

Guidelines:
- Sound like a real person helping, not a marketer. Be genuinely helpful first.
- Mention the product naturally, not as an ad. Lead with solving their problem.
- Keep it concise (3–6 sentences max).
- Do not use salesy language, exclamation marks, or generic openers like "Hey!"
- If the product directly solves their exact problem, be clear about it.
- If only partially relevant, acknowledge limitations honestly.
- Mention the product URL once at most if relevant.
- Match the tone of r/${post.subreddit}.
- Promotion intensity: ${product.promotionIntensity} (subtle = barely mention product; direct = lead with product recommendation).
- Write in English.
- Do NOT reveal this reply was AI-generated.
${extraTone ? `\nTone override: ${extraTone}` : ''}`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Reddit post from r/${post.subreddit}:\nTitle: ${post.title}\n\n${post.body.slice(0, 1500)}\n\nWrite a reply:`
    }],
  })

  return message.content[0].type === 'text' ? message.content[0].text : ''
}
```

**Step 2: Draft generation API**

```typescript
// src/app/api/posts/[id]/draft/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db, redditPosts, products, replyDrafts } from '@/db'
import { eq, and, desc } from 'drizzle-orm'
import { generateReplyDraft } from '@/lib/ai'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { tone } = await req.json().catch(() => ({}))

  const [postRow] = await db.select().from(redditPosts).where(eq(redditPosts.id, params.id))
  if (!postRow) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const [product] = await db.select().from(products).where(eq(products.id, postRow.productId))
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const draft = await generateReplyDraft(product, {
    title: postRow.title,
    body: postRow.body,
    subreddit: postRow.subreddit,
  }, tone)

  // Get current version count
  const existingDrafts = await db.select({ version: replyDrafts.version })
    .from(replyDrafts)
    .where(eq(replyDrafts.postId, params.id))
    .orderBy(desc(replyDrafts.version))
    .limit(1)

  const version = (existingDrafts[0]?.version ?? 0) + 1

  const [saved] = await db.insert(replyDrafts).values({
    postId: params.id,
    productId: product.id,
    body: draft,
    version,
  }).returning()

  // Update post status to 'draft'
  await db.update(redditPosts).set({ status: 'draft' }).where(eq(redditPosts.id, params.id))

  return NextResponse.json(saved)
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const drafts = await db.select().from(replyDrafts)
    .where(eq(replyDrafts.postId, params.id))
    .orderBy(desc(replyDrafts.version))
  return NextResponse.json(drafts)
}
```

**Step 3: Approve API**

```typescript
// src/app/api/posts/[id]/approve/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db, redditPosts, replyDrafts } from '@/db'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { draftId, body } = await req.json()

  await db.update(replyDrafts).set({
    body,
    isApproved: true,
    approvedAt: new Date(),
  }).where(eq(replyDrafts.id, draftId))

  await db.update(redditPosts).set({ status: 'approved' }).where(eq(redditPosts.id, params.id))

  return NextResponse.json({ ok: true })
}
```

**Step 4: Post-to-Reddit API**

```typescript
// src/app/api/posts/[id]/post/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db, redditPosts, replyDrafts } from '@/db'
import { eq } from 'drizzle-orm'
import { getToken } from '@/lib/reddit-auth'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { draftId, body } = await req.json()

  const [post] = await db.select().from(redditPosts).where(eq(redditPosts.id, params.id))
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'Reddit not connected' }, { status: 401 })

  // Submit comment via Reddit API
  const res = await fetch('https://oauth.reddit.com/api/comment', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'RedditMarketingMonitor/1.0',
    },
    body: new URLSearchParams({
      api_type: 'json',
      text: body,
      thing_id: `t3_${post.redditPostId}`, // t3_ prefix for posts
    }),
  })

  const data = await res.json()
  if (data.json?.errors?.length > 0) {
    return NextResponse.json({ error: data.json.errors[0][1] }, { status: 400 })
  }

  const comment = data.json?.data?.things?.[0]?.data
  const commentId = comment?.id
  const commentUrl = `https://reddit.com${comment?.permalink ?? ''}`

  await db.update(replyDrafts).set({
    body,
    isApproved: true,
    isPosted: true,
    approvedAt: new Date(),
    postedAt: new Date(),
    redditCommentId: commentId,
    redditCommentUrl: commentUrl,
  }).where(eq(replyDrafts.id, draftId))

  await db.update(redditPosts).set({ status: 'posted' }).where(eq(redditPosts.id, params.id))

  return NextResponse.json({ ok: true, commentUrl })
}
```

**Step 5: Reply editor page**

```tsx
// src/app/reply/[postId]/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ExternalLink, RefreshCw, Copy, Send } from 'lucide-react'

export default function ReplyPage() {
  const { postId } = useParams()
  const [post, setPost] = useState<any>(null)
  const [drafts, setDrafts] = useState<any[]>([])
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null)
  const [editedBody, setEditedBody] = useState('')
  const [generating, setGenerating] = useState(false)
  const [tone, setTone] = useState('default')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [posting, setPosting] = useState(false)
  const [postedUrl, setPostedUrl] = useState<string | null>(null)

  async function loadPost() {
    const [postRes, draftsRes] = await Promise.all([
      fetch(`/api/posts/${postId}`),
      fetch(`/api/posts/${postId}/draft`),
    ])
    const postData = await postRes.json()
    const draftsData = await draftsRes.json()
    setPost(postData.post ?? postData)
    setDrafts(draftsData)
    if (draftsData.length > 0) {
      setCurrentDraftId(draftsData[0].id)
      setEditedBody(draftsData[0].body)
    }
  }

  useEffect(() => { loadPost() }, [postId])

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
    await fetch(`/api/posts/${postId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: currentDraftId, body: editedBody }),
    })
    await navigator.clipboard.writeText(editedBody)
    alert('Approved and copied to clipboard!')
  }

  async function handlePost() {
    setPosting(true)
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
      alert(`Failed to post: ${data.error}`)
    }
  }

  if (!post) return <div className="p-6">Loading...</div>

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">r/{post.subreddit}</Badge>
        </div>
        <a href={post.url} target="_blank" rel="noopener noreferrer"
          className="font-semibold text-lg hover:underline flex items-center gap-1">
          {post.title} <ExternalLink size={16} />
        </a>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{post.body}</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Select value={tone} onValueChange={setTone}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
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

        {drafts.length > 1 && (
          <div className="flex gap-2 text-sm text-muted-foreground">
            Previous drafts:
            {drafts.slice(1, 3).map(d => (
              <button key={d.id} onClick={() => { setCurrentDraftId(d.id); setEditedBody(d.body) }}
                className="underline hover:text-foreground">
                v{d.version}
              </button>
            ))}
          </div>
        )}

        <Textarea
          value={editedBody}
          onChange={e => setEditedBody(e.target.value)}
          rows={8}
          placeholder="Generate a draft or write your reply here..."
        />
        <p className="text-xs text-muted-foreground text-right">{editedBody.length} / 10,000 chars</p>
      </div>

      {postedUrl ? (
        <div className="p-4 bg-green-50 rounded-lg">
          <p className="text-green-800 font-medium">✅ Posted successfully!</p>
          <a href={postedUrl} target="_blank" rel="noopener noreferrer"
            className="text-sm underline text-green-700">View on Reddit</a>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCopyOnly} disabled={!editedBody}>
            <Copy size={14} className="mr-1" /> Approve (Copy Only)
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={!editedBody}>
            <Send size={14} className="mr-1" /> Approve &amp; Post
          </Button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm: Post to Reddit?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Posting to: <a href={post.url} target="_blank" rel="noopener noreferrer" className="underline">{post.url}</a>
            </p>
            <div className="bg-gray-50 rounded p-3 text-sm whitespace-pre-wrap">{editedBody}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
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

**Step 6: Test reply flow**

1. Go to dashboard, click "Draft Reply" on a post
2. Verify draft appears in textarea within 10 seconds
3. Click "Regenerate" — second draft appears, first still accessible as v1
4. Change tone to "Technical", regenerate — tone should be noticeably different
5. Click "Approve (Copy Only)" — check clipboard
6. For "Approve & Post": only test with a real low-traffic post you control; verify comment appears on Reddit

**Step 7: Commit**

```bash
git add .
git commit -m "feat: reply editor with AI draft generation and posting"
```

---

## Task 10: Settings UI — Reddit OAuth & Notifications

**Files:**
- Create: `src/app/settings/reddit/page.tsx`
- Create: `src/app/settings/notifications/page.tsx`
- Create: `src/app/api/settings/notifications/route.ts`
- Create: `src/lib/notify.ts`

**Step 1: Reddit settings page**

```tsx
// src/app/settings/reddit/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function RedditSettingsPage() {
  const [status, setStatus] = useState<{ connected: boolean; username: string | null }>({
    connected: false, username: null,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/reddit/status').then(r => r.json()).then(data => {
      setStatus(data)
      setLoading(false)
    })
  }, [])

  async function disconnect() {
    await fetch('/api/auth/reddit/disconnect', { method: 'POST' })
    setStatus({ connected: false, username: null })
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Reddit Connection</h1>
      <Card>
        <CardHeader><CardTitle>Reddit Account</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {loading ? <p>Loading...</p> : status.connected ? (
            <>
              <p className="text-green-700 font-medium">✅ Connected as u/{status.username}</p>
              <Button variant="destructive" onClick={disconnect}>Disconnect</Button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">Connect your Reddit account to post replies.</p>
              <Button asChild>
                <a href="/api/auth/reddit/connect">Connect Reddit Account</a>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 2: Notifications settings API**

```typescript
// src/app/api/settings/notifications/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db, appSettings } from '@/db'
import { eq } from 'drizzle-orm'

const NOTIF_KEY = 'notification_settings'

export async function GET() {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, NOTIF_KEY))
  const settings = rows.length ? JSON.parse(rows[0].value) : {
    email: process.env.NOTIFICATION_EMAIL ?? '',
    threshold: 'high',
    quietStart: '23:00',
    quietEnd: '08:00',
    telegramEnabled: false,
  }
  return NextResponse.json(settings)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  await db.insert(appSettings)
    .values({ key: NOTIF_KEY, value: JSON.stringify(body) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(body), updatedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
```

**Step 3: Notification sender**

```typescript
// src/lib/notify.ts
import { Resend } from 'resend'
import { db, appSettings } from '@/db'
import { eq } from 'drizzle-orm'

const resend = new Resend(process.env.RESEND_API_KEY)

interface Post {
  title: string
  subreddit: string
  url: string
  relevanceReason: string
  id: string
}

function isQuietHours(quietStart: string, quietEnd: string): boolean {
  const now = new Date()
  const [sh, sm] = quietStart.split(':').map(Number)
  const [eh, em] = quietEnd.split(':').map(Number)
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes()
  const startMins = sh * 60 + sm
  const endMins = eh * 60 + em
  if (startMins < endMins) return nowMins >= startMins && nowMins < endMins
  return nowMins >= startMins || nowMins < endMins // overnight
}

export async function sendNewPostsNotification(posts: Post[]) {
  if (!posts.length) return

  const rows = await db.select().from(appSettings).where(eq(appSettings.key, 'notification_settings'))
  if (!rows.length) return

  const settings = JSON.parse(rows[0].value)
  if (!settings.email) return
  if (isQuietHours(settings.quietStart, settings.quietEnd)) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const html = `
    <h2>Reddit Marketing Monitor — ${posts.length} new relevant post${posts.length > 1 ? 's' : ''}</h2>
    ${posts.map(p => `
      <div style="border:1px solid #eee;padding:12px;margin:8px 0;border-radius:6px">
        <strong>r/${p.subreddit}</strong><br/>
        <a href="${p.url}">${p.title}</a><br/>
        <em>${p.relevanceReason}</em><br/>
        <a href="${appUrl}/reply/${p.id}">Draft Reply →</a>
      </div>
    `).join('')}
  `

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: settings.email,
    subject: `[RMM] ${posts.length} new Reddit post${posts.length > 1 ? 's' : ''} to reply to`,
    html,
  })
}
```

**Step 4: Wire notifications into scanner**

In `src/lib/scanner.ts`, after inserting new posts, collect the high/medium ones and send notification:

```typescript
// Add at end of runScan(), before the final updateLog call:
const { sendNewPostsNotification } = await import('./notify')
const notifSettings = ... // fetch from DB
const threshold = notifSettings?.threshold ?? 'high'
const tierFilter = threshold === 'high' ? ['high'] : ['high', 'medium']
// Filter newly added posts by tier and send
// (collect newHighPosts array during insertion loop above)
await sendNewPostsNotification(newHighPosts.filter(p => tierFilter.includes(p.relevanceTier)))
```

**Step 5: Commit**

```bash
git add .
git commit -m "feat: Reddit settings page and email notifications"
```

---

## Task 11: Automated Scan Scheduler

**Files:**
- Create: `src/lib/cron.ts`
- Create: `src/app/api/cron/scan/route.ts` (for Vercel Cron)
- Modify: `vercel.json`

**Step 1: Vercel Cron config**

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/scan",
      "schedule": "0 */3 * * *"
    }
  ]
}
```

**Step 2: Cron API route**

```typescript
// src/app/api/cron/scan/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { runScan } from '@/lib/scanner'

export async function GET(req: NextRequest) {
  // Vercel sends this header to verify the cron call is legitimate
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runScan('scheduled')
    return NextResponse.json(result)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Scan failed'
    console.error('Scheduled scan failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

Add `CRON_SECRET` to env vars (a random string you set in Vercel dashboard).

**Step 3: Scan history UI**

```tsx
// src/app/scan/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw } from 'lucide-react'

export default function ScanPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [scanning, setScanning] = useState(false)

  async function loadLogs() {
    const res = await fetch('/api/scan/history')
    setLogs(await res.json())
  }

  useEffect(() => { loadLogs() }, [])

  async function scanNow() {
    setScanning(true)
    await fetch('/api/scan', { method: 'POST' })
    setScanning(false)
    loadLogs()
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Scan History</h1>
        <Button onClick={scanNow} disabled={scanning}>
          <RefreshCw size={14} className={`mr-1 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Scanning...' : 'Scan Now'}
        </Button>
      </div>
      <div className="space-y-2">
        {logs.map(log => (
          <div key={log.id} className="border rounded p-3 flex flex-wrap gap-3 items-center text-sm">
            <Badge variant={log.triggeredBy === 'manual' ? 'secondary' : 'outline'}>
              {log.triggeredBy}
            </Badge>
            <Badge variant={log.status === 'completed' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'}>
              {log.status}
            </Badge>
            <span>{new Date(log.startedAt).toLocaleString()}</span>
            <span>{log.newPosts} new posts</span>
            <span>{log.claudeCalls} Claude calls</span>
            {log.errorMessage && <span className="text-red-500">{log.errorMessage}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add .
git commit -m "feat: Vercel cron scheduler and scan history UI"
```

---

## Task 12: Analytics & Post History

**Files:**
- Create: `src/app/analytics/page.tsx`
- Create: `src/app/api/analytics/route.ts`
- Create: `src/app/history/page.tsx`
- Create: `src/app/api/posts/history/route.ts`

**Step 1: Analytics API**

```typescript
// src/app/api/analytics/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db, redditPosts, products } from '@/db'
import { eq, and, gte, sql, count } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const productId = searchParams.get('productId')
  const days = parseInt(searchParams.get('days') ?? '30')
  const since = new Date(Date.now() - days * 86400_000)

  const conditions = [gte(redditPosts.fetchedAt, since)]
  if (productId) conditions.push(eq(redditPosts.productId, productId))

  const [byTier, bySubreddit, byKeyword, replyRate] = await Promise.all([
    // Posts by tier
    db.select({
      tier: redditPosts.relevanceTier,
      count: count(),
    }).from(redditPosts).where(and(...conditions)).groupBy(redditPosts.relevanceTier),

    // Posts by subreddit (top 10)
    db.select({
      subreddit: redditPosts.subreddit,
      count: count(),
    }).from(redditPosts).where(and(...conditions)).groupBy(redditPosts.subreddit)
      .orderBy(sql`count(*) desc`).limit(10),

    // Simple total
    db.select({ count: count() }).from(redditPosts).where(and(...conditions)),

    // Reply rate
    db.select({
      status: redditPosts.status,
      count: count(),
    }).from(redditPosts).where(and(
      ...conditions,
      eq(redditPosts.relevanceTier, 'high')
    )).groupBy(redditPosts.status),
  ])

  const totalHigh = replyRate.reduce((a, r) => a + r.count, 0)
  const posted = replyRate.find(r => r.status === 'posted')?.count ?? 0

  return NextResponse.json({
    total: replyRate.reduce((a, r) => a + r.count, 0),
    byTier,
    bySubreddit,
    replyRate: totalHigh > 0 ? Math.round((posted / totalHigh) * 100) : 0,
    posted,
    totalHigh,
  })
}
```

**Step 2: Analytics page**

```tsx
// src/app/analytics/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null)
  const [days, setDays] = useState('30')

  useEffect(() => {
    fetch(`/api/analytics?days=${days}`).then(r => r.json()).then(setData)
  }, [days])

  if (!data) return <div className="p-6">Loading...</div>

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {data.byTier.map((t: any) => (
          <Card key={t.tier}>
            <CardHeader className="pb-2"><CardTitle className="text-sm capitalize">{t.tier} relevance</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold">{t.count}</p></CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Reply Rate (High posts)</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{data.replyRate}%</p>
          <p className="text-xs text-muted-foreground">{data.posted} of {data.totalHigh} posted</p></CardContent>
        </Card>
      </div>

      <div>
        <h2 className="font-semibold mb-2">Top Subreddits</h2>
        <div className="space-y-1">
          {data.bySubreddit.map((s: any) => (
            <div key={s.subreddit} className="flex justify-between text-sm border-b py-1">
              <span>r/{s.subreddit}</span>
              <span>{s.count} posts</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

**Step 3: History API**

```typescript
// src/app/api/posts/history/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db, redditPosts, products } from '@/db'
import { eq, and, desc, like, ilike } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('q')
  const status = searchParams.get('status')
  const productId = searchParams.get('productId')

  const conditions = []
  if (status) conditions.push(eq(redditPosts.status, status as any))
  if (productId) conditions.push(eq(redditPosts.productId, productId))
  if (search) conditions.push(ilike(redditPosts.title, `%${search}%`))

  const rows = await db
    .select({ post: redditPosts, product: { id: products.id, name: products.name } })
    .from(redditPosts)
    .leftJoin(products, eq(redditPosts.productId, products.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(redditPosts.fetchedAt))
    .limit(200)

  return NextResponse.json(rows)
}
```

**Step 4: History page with CSV export**

```tsx
// src/app/history/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Download, ExternalLink } from 'lucide-react'

export default function HistoryPage() {
  const [rows, setRows] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  async function load() {
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (statusFilter) params.set('status', statusFilter)
    const res = await fetch(`/api/posts/history?${params}`)
    setRows(await res.json())
  }

  useEffect(() => { load() }, [search, statusFilter])

  function exportCsv() {
    const headers = ['title', 'subreddit', 'product', 'tier', 'status', 'fetchedAt', 'url']
    const csvRows = [headers.join(',')]
    for (const { post, product } of rows) {
      csvRows.push([
        `"${post.title.replace(/"/g, '""')}"`,
        post.subreddit,
        product?.name ?? '',
        post.relevanceTier,
        post.status,
        post.fetchedAt,
        post.url,
      ].join(','))
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `reddit-posts-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Post History ({rows.length})</h1>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download size={14} className="mr-1" /> Export CSV
        </Button>
      </div>
      <div className="flex gap-2">
        <Input placeholder="Search titles..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded px-2 text-sm">
          <option value="">All statuses</option>
          {['new','draft','approved','posted','skipped','bookmarked'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        {rows.map(({ post, product }) => (
          <div key={post.id} className="border rounded p-3 flex flex-wrap gap-2 items-center text-sm">
            <Badge variant="outline">r/{post.subreddit}</Badge>
            <Badge variant="secondary">{product?.name}</Badge>
            <Badge>{post.relevanceTier}</Badge>
            <Badge variant="outline">{post.status}</Badge>
            <a href={post.url} target="_blank" rel="noopener noreferrer"
              className="flex-1 hover:underline flex items-center gap-1 min-w-0">
              <span className="truncate">{post.title}</span>
              <ExternalLink size={12} className="shrink-0" />
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Step 5: Commit**

```bash
git add .
git commit -m "feat: analytics dashboard and post history with CSV export"
```

---

## Task 13: Navigation & Polish

**Files:**
- Create: `src/components/AppNav.tsx`
- Modify: `src/app/layout.tsx`

**Step 1: Navigation**

```tsx
// src/components/AppNav.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: 'Queue' },
  { href: '/scan', label: 'Scan' },
  { href: '/history', label: 'History' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/settings/products', label: 'Products' },
  { href: '/settings/notifications', label: 'Notifications' },
  { href: '/settings/reddit', label: 'Reddit' },
]

export function AppNav() {
  const path = usePathname()
  return (
    <nav className="border-b px-6 py-3 flex gap-6 text-sm">
      <span className="font-bold mr-4">RMM</span>
      {links.map(l => (
        <Link key={l.href} href={l.href}
          className={path === l.href ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}>
          {l.label}
        </Link>
      ))}
    </nav>
  )
}
```

**Step 2: Add nav to layout**

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AppNav } from '@/components/AppNav'
import { Toaster } from '@/components/ui/toaster'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = { title: 'Reddit Marketing Monitor' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AppNav />
        <main>{children}</main>
        <Toaster />
      </body>
    </html>
  )
}
```

**Step 3: Run full app and smoke test**

Follow the 18-step smoke test in SPEC.md section 11.3. Fix any failures before calling this done.

**Step 4: Commit**

```bash
git add .
git commit -m "feat: navigation and layout polish"
```

---

## Task 14: Deployment to Vercel

**Step 1: Push to GitHub**

```bash
git remote add origin https://github.com/<your-username>/reddit-marketing-monitor.git
git push -u origin main
```

**Step 2: Import to Vercel**

1. Go to vercel.com → New Project → Import from GitHub
2. Select the repo
3. Add all environment variables from `.env.local` to Vercel project settings
4. Add `CRON_SECRET` (random string) and `NEXT_PUBLIC_APP_URL` (your Vercel domain)
5. Deploy

**Step 3: Update Reddit app redirect URI**

Go to reddit.com/prefs/apps and update the redirect URI from `localhost:3000` to your Vercel domain.

**Step 4: Run production smoke test**

Repeat the 18-step smoke test against the production URL.

**Step 5: Tag release**

```bash
git tag v1.0.0
git push --tags
```

---

## Quick Reference

| Route | Purpose |
|---|---|
| `/` | Post queue dashboard |
| `/scan` | Manual scan + history |
| `/reply/[postId]` | Reply editor |
| `/history` | All posts archive |
| `/analytics` | Stats |
| `/settings/products` | Configure products |
| `/settings/notifications` | Email alerts |
| `/settings/reddit` | OAuth connection |

| Key File | Purpose |
|---|---|
| `src/lib/scanner.ts` | Core scan logic |
| `src/lib/ai.ts` | Claude API calls |
| `src/lib/reddit-auth.ts` | OAuth + token refresh |
| `src/lib/notify.ts` | Email notifications |
| `src/db/schema.ts` | Database schema |

**Validation:** After each task, run the corresponding checklist from SPEC.md Section 11.2 before committing the next task.
