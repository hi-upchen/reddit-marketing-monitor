# Reddit Marketing Monitor

Personal tool to scan Reddit for posts relevant to your indie products, generate AI reply drafts with Gemini, and post them with one click.

Built for indie hackers who want to find and engage with relevant Reddit discussions without spending hours browsing.

## Tech Stack

- **Next.js 16** with Turbopack
- **Tailwind CSS v4** + shadcn/ui components
- **Turso** (remote libSQL) for database
- **Gemini 2.5 Flash** for AI scoring and reply drafting
- **Reddit API** (public for reading, OAuth for posting)
- **Resend** for email notifications

## Features

- **Reddit Scanner** — Searches Reddit by configurable keywords and subreddits. Uses public API for reading (no OAuth needed). Caches results to avoid rate limits.
- **AI Relevance Scoring** — Gemini scores each post 0-10 for product relevance. Only high-scoring posts surface in your queue.
- **AI Reply Drafts** — Generates 3 reply variations per post (different tones). Accepts optional user prompts to guide the AI. Includes product mentions with UTM-tracked links.
- **Reply Editor** — Edit drafts freely, pick from AI suggestions, or write from scratch. Approve to clipboard or post directly to Reddit.
- **Multi-Product Support** — Configure multiple products with name, URL, description, features, target audience, reply tone, and promotion intensity.
- **Analytics** — Top subreddits, keywords, reply rate, and scan history.
- **Notifications** — Email (via Resend) and Telegram alerts for high-relevance posts.
- **Password Auth** — Simple password login with session tokens. No user registration needed.
- **Reddit OAuth** — Connect your Reddit account to post replies directly from the app.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Post queue — filter by status (new, draft, approved, posted, skipped) |
| `/reply/[postId]` | Reply editor with AI suggestions |
| `/scan` | Manual scan trigger + scan settings |
| `/analytics` | Stats dashboard |
| `/history` | Scan and reply history |
| `/settings/products` | Product management |
| `/settings/notifications` | Notification settings |
| `/login` | Password login |

## Setup

### Prerequisites

- Node.js 18+
- A [Turso](https://turso.tech) database
- A [Gemini API key](https://aistudio.google.com/apikey)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create `.env.local`:

```env
# Required
APP_PASSWORD=your_login_password
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your_turso_token
GEMINI_API_KEY=AIzaSy...

# Auto-generated secrets (use `openssl rand -hex 32`)
ENCRYPTION_KEY=<64-char-hex>
CRON_SECRET=<random-string>
SESSION_SECRET=<random-string>

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional: Reddit OAuth (needed to post replies)
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_secret
REDDIT_REDIRECT_URI=http://localhost:3000/api/auth/reddit/callback

# Optional: Notifications
RESEND_API_KEY=re_...
NOTIFICATION_EMAIL=you@example.com
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=your_chat_id
```

### 3. Run

```bash
npm run dev
```

Open http://localhost:3000, log in with your `APP_PASSWORD`, and hit **Scan Now**.

Database tables are auto-created on first startup via `instrumentation.ts`.

## Reddit OAuth Setup

To post replies directly to Reddit:

1. Go to https://www.reddit.com/prefs/apps
2. Create a "web app" with redirect URI: `http://localhost:3000/api/auth/reddit/callback`
3. Add `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` to `.env.local`
4. In the app, go to **Settings** and connect your Reddit account

Without OAuth, you can still scan and draft replies — just use "Approve & Copy" to paste them manually.

## Cron Scanning

Set up automated scanning by calling the cron endpoint:

```
GET /api/cron/scan
Authorization: Bearer <CRON_SECRET>
```

Use any cron service (Vercel Cron, Railway, or a simple `curl` in crontab).

## License

MIT
