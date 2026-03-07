# Reddit Marketing Monitor — Product Specification

Products: Kobo Note Up (https://kobo-up.runawayup.com/) | txtconv (https://txtconv.arpuli.com/)  
Author: 出走工程師 Up  
Version: 1.0 | Date: March 2026  
Purpose: Internal tool — personal Reddit lead engagement for two indie products

---

## 1. Overview

A personal Reddit Marketing Monitor — a lightweight web app that continuously scans Reddit for posts where the creator's two indie products are relevant, drafts AI-powered replies, and lets the creator approve and post them manually.

Inspired by ReplyHub.co, with key differences:

- Multi-product support: manages two products simultaneously with separate product contexts
- Creator-first: built for a solo indie maker, not agencies or teams
- Manual approval always: nothing is posted without explicit creator approval
- No managed/bot accounts: uses the creator's own Reddit account via Reddit OAuth
- Privacy by design: minimal data stored, no tracking of Reddit users

---

## 2. Products Being Promoted

### 2.1 Kobo Note Up

| Field | Details |
|---|---|
| URL | https://kobo-up.runawayup.com/ |
| Description | Browser-based tool to export Kobo e-reader highlights, notes, and stylus handwriting annotations. 100% local (WebAssembly), no server, no data upload. |
| Target users | Kobo e-reader owners who want to export highlights to Obsidian, Notion, Markdown, or plain text |
| Key pain point solved | Kobo's official export randomly fails, ignores sideloaded books, and truncates long highlights |
| Monetization | Donations via Buy Me a Coffee; open source |
| Key features | Auto-detects KoboReader.sqlite, supports sideloaded books, exports highlight colors, stylus ink annotations, Markdown/text export |

### 2.2 txtconv

| Field | Details |
|---|---|
| URL | https://txtconv.arpuli.com/ |
| Description | Online Simplified Chinese to Traditional Chinese converter for plain text files, subtitles (SRT), CSV, and XML. Supports batch conversion and custom dictionary overrides. |
| Target users | Chinese readers, subtitle editors, bloggers converting Simplified Chinese novels/subtitles to Traditional Chinese (Taiwan/Hong Kong) |
| Key pain point solved | Existing converters are inaccurate for domain-specific vocabulary (tech, media, fiction); no support for file batch conversion |
| Monetization | Free tier (5MB, 5 custom dict entries); Lifetime plan $15 USD (100MB, 10,000 dict entries) via Gumroad |
| Key features | Supports .txt, .srt, .csv, .xml; custom dictionary; batch files; browser-based |

---

## 3. Recommended Tech Stack

| Layer | Choice & Rationale |
|---|---|
| Frontend | Next.js (React) — single app with dashboard, post queue, reply editor |
| Backend / API | Next.js API routes or a lightweight Node/Express server |
| Database | SQLite (local) or Supabase (free tier) — stores posts, reply drafts, approval status |
| Reddit API | Official Reddit OAuth2 API — snoowrap (Node.js Reddit API wrapper) for post fetching and comment submission |
| AI / Reply drafting | Anthropic Claude API (claude-sonnet) for reply generation |
| Scheduler | Node-cron or Vercel Cron Jobs — runs Reddit scan every 2–4 hours |
| Auth | Single-user — simple password gate or Reddit OAuth for the owner only |
| Deployment | Vercel (free tier) or Railway — minimal infrastructure cost |
| Notifications | Email (Resend / Nodemailer) and/or Telegram bot for new post alerts |

---

## 4. Feature Specifications

### 4.1 Product Configuration

The creator configures each product once. These settings power all AI-generated replies and relevance scoring.

#### 4.1.1 Product Profile

Each product entry contains:

- Product name
- URL (used in replies and relevance context)
- Short description (2–3 sentences, what it does and who it's for)
- Key problems it solves (comma-separated or list)
- Key features (comma-separated or list)
- Target audience description
- Tone for replies (e.g. "helpful and friendly", "technical", "casual indie maker")
- Promotion intensity: Subtle / Moderate / Direct — controls how prominently the product is mentioned in replies
- Active toggle: enable/disable monitoring per product

#### 4.1.2 Keyword Configuration

Each product has a list of monitored keywords. The system suggests keywords based on product description; the creator can add/remove/edit.

Example keywords for Kobo Note Up:
- kobo highlights export
- kobo notes export
- kobo export not working
- kobo sideloaded books
- kobo obsidian
- kobo stylus annotations
- export ebook highlights

Example keywords for txtconv:
- simplified to traditional chinese
- 簡繁轉換
- srt subtitle converter
- chinese text converter
- kobo chinese ebook

#### 4.1.3 Subreddit Targeting

Per product, optionally restrict scanning to specific subreddits. The system provides a curated default list based on product type.

Kobo Note Up defaults: r/kobo, r/ObsidianMD, r/Notion, r/ebooks, r/kindle, r/productivity, r/readingandwriting, r/selfhosted

txtconv defaults: r/ChineseLanguage, r/translator, r/kdrama, r/anime, r/learnChinese, r/hongkong, r/taiwan

Settings also allow: scan ALL of Reddit (with keyword filter), or exclude specific subreddits.

---

### 4.2 Reddit Scanning Engine

#### 4.2.1 Scan Frequency

- Default: every 3 hours (configurable: 1h / 3h / 6h / 12h / daily)
- Manual scan: "Scan Now" button triggers immediate scan
- Last scan timestamp displayed in dashboard header

#### 4.2.2 Post Discovery

For each product, the scanner:

1. Searches Reddit using the Reddit Search API (`/search` endpoint) with each configured keyword
2. Queries across configured subreddits (or all of Reddit if global mode is on)
3. Fetches posts from the past 7 days (configurable: 24h / 3d / 7d / 30d)
4. Deduplicates across keyword matches (same post can match multiple keywords but is stored once)
5. Skips posts already in the database (tracks by Reddit post ID)
6. Fetches: post title, body, author, subreddit, score, comment count, URL, created timestamp

#### 4.2.3 Relevance Scoring

Each discovered post is scored for relevance using a two-step system:

- Step 1 — Keyword score: how many configured keywords appear in title/body, weighted by position (title match scores higher)
- Step 2 — AI relevance score: Claude analyzes the post and rates it 1–10 for relevance to the product, with a one-sentence reason

Final relevance tiers:

| Tier | Score | Meaning |
|---|---|---|
| High | 7–10 | Post directly describes a problem the product solves |
| Medium | 4–6 | Post is topically related but may not be a direct fit |
| Low | 1–3 | Weak match — keyword appeared but context is unrelated |

Posts scored Low are hidden by default but accessible via filter. Posts already replied to by the creator's Reddit account are auto-marked as Done.

---

### 4.3 Post Queue Dashboard

The main screen the creator sees daily — a list of discovered posts awaiting review.

#### 4.3.1 Post Card

Each post displays:

- Subreddit badge (e.g. r/kobo)
- Product badge (which product this is relevant to)
- Relevance tier badge: High / Medium / Low
- Post title (clickable, opens Reddit in new tab)
- Post body snippet (first 200 chars, expandable to full text)
- Author, upvote score, comment count, time posted
- Matched keyword(s)
- AI relevance reason (1-sentence explanation)
- Status: New / Draft / Approved / Posted / Skipped

#### 4.3.2 Queue Filters

- Filter by product (Kobo Note Up / txtconv / All)
- Filter by relevance tier (High / Medium / Low / All)
- Filter by status (New / Draft / Approved / Posted / Skipped)
- Filter by subreddit
- Sort by: newest / highest score / highest relevance

#### 4.3.3 Post Actions

- Draft Reply — opens reply editor with AI-generated draft
- Skip — marks post as Skipped, moves it out of queue (with undo)
- Open Reddit — opens post in new tab
- Bookmark — saves for later without drafting

---

### 4.4 AI Reply Generation

#### 4.4.1 Generation Process

When "Draft Reply" is clicked, the system:

1. Sends the post title, body, subreddit, and the full product context to Claude API
2. Claude generates a reply following tone and promotion intensity settings
3. Draft is shown in an editable text area immediately

#### 4.4.2 System Prompt Design

The AI prompt instructs Claude to:

- Sound like a real person helping, not a marketer
- Lead with solving the user's problem — product mention comes naturally
- Keep replies to 3–6 sentences (no essays)
- Never use salesy language, exclamation marks, or generic openers like "Hey!"
- Mention the product URL only once if relevant
- If the product is only partially relevant, acknowledge limitations honestly
- Match the subreddit's culture (r/ObsidianMD users are technical; r/kobo users may be less so)
- Not reveal it's an AI-generated reply

#### 4.4.3 Reply Editor

The reply editor provides:

- Editable textarea with the AI draft
- Word / character count (Reddit max is 10,000 chars)
- Regenerate button — generates a new draft (keeps previous draft visible for comparison)
- Draft history — stores up to 3 previous generated drafts for the same post
- Tone selector override: Helpful / Technical / Personal Story / Minimal — regenerates with new tone
- Product link quick-insert button
- Preview pane showing rendered Markdown (Reddit supports basic Markdown)

---

### 4.5 Approval & Posting Workflow

> Core Principle: NOTHING is posted to Reddit without explicit creator approval. The tool never auto-posts. Every reply must be manually approved before submission.

#### 4.5.1 Approval Flow

1. Creator reviews draft in the reply editor
2. Creator edits the draft as needed
3. Creator clicks "Approve & Post" — a confirmation dialog shows the final reply text and target post URL
4. Creator confirms — the tool posts the reply via Reddit API using the creator's own OAuth account
5. Post is marked as "Posted" with timestamp and a link to the live comment

#### 4.5.2 Approve Without Posting

"Approve (Copy Only)" option — saves the approved reply text and marks the post as Approved, but does NOT post via API. Creator manually pastes the reply on Reddit. Useful for posts where the creator wants full control over the exact moment of posting.

#### 4.5.3 Reddit OAuth Integration

The tool connects to the creator's own Reddit account via Reddit's official OAuth2 flow:

- Scopes needed: identity, submit
- Access token stored securely (server-side, encrypted at rest)
- Token refresh handled automatically
- Reddit username displayed in settings to confirm the connected account

---

### 4.6 Notifications

When new high-relevance posts are found, the creator is notified so they can reply while the post is still fresh.

- Email notification: sends a digest of new High-relevance posts found in each scan
- Telegram bot notification (optional): sends an instant message per High-relevance post with title, subreddit, and a link to open the app
- Notification threshold: configurable — notify on All / High only / High+Medium
- Quiet hours: define hours when notifications are suppressed (e.g. 11pm–7am)
- Notification frequency: per-scan digest or immediate per-post

---

### 4.7 Analytics & Tracking

#### 4.7.1 Post Analytics

- Total posts found (all time / by product / by date range)
- Posts by relevance tier breakdown
- Posts by subreddit — which subreddits generate the most relevant discussions
- Posts by keyword — which keywords are most productive
- Reply rate — % of High-relevance posts where a reply was posted

#### 4.7.2 Reply Performance

After posting a reply, the tool periodically checks back on the comment to track:

- Upvote score of the posted comment
- Number of replies to the comment
- Whether the post author responded

#### 4.7.3 UTM Link Tracking

When the product URL is included in a reply, the tool automatically appends UTM parameters:

- utm_source=reddit
- utm_medium=comment
- utm_campaign=kobo-note-up or txtconv (per product)
- utm_content={subreddit_name}

This allows the creator to track Reddit-sourced traffic in any analytics tool (Plausible, Simple Analytics, etc.).

---

### 4.8 Post History & Archive

- Full history of all discovered posts, with their status (New / Skipped / Replied / etc.)
- Searchable by keyword, subreddit, date, product, status
- Exportable as CSV for offline analysis
- Soft-delete only: posts are never permanently deleted, just hidden from queue

---

## 5. Data Models

### 5.1 Product

| Field | Type / Description |
|---|---|
| id | UUID primary key |
| name | string — product display name |
| url | string — product URL |
| description | text — product description for AI context |
| problems_solved | text — key pain points (for AI context) |
| features | text — key features (for AI context) |
| target_audience | text — who uses this product |
| reply_tone | string — e.g. "helpful and casual" |
| promotion_intensity | enum: subtle \| moderate \| direct |
| keywords | JSON array of strings |
| subreddits | JSON array of subreddit names (empty = all Reddit) |
| is_active | boolean |
| created_at | timestamp |

### 5.2 RedditPost

| Field | Type / Description |
|---|---|
| id | UUID primary key |
| reddit_post_id | string — Reddit's own post ID (t3_xxxxx), unique |
| product_id | FK → Product |
| subreddit | string |
| title | text |
| body | text |
| author | string — Reddit username |
| score | integer — upvotes at time of fetch |
| comment_count | integer |
| url | string — full Reddit post URL |
| matched_keywords | JSON array — which keywords triggered this |
| relevance_score | integer 1–10 |
| relevance_tier | enum: high \| medium \| low |
| relevance_reason | text — AI explanation |
| status | enum: new \| draft \| approved \| posted \| skipped \| bookmarked |
| reddit_created_at | timestamp — when post was created on Reddit |
| fetched_at | timestamp — when we discovered it |

### 5.3 ReplyDraft

| Field | Type / Description |
|---|---|
| id | UUID primary key |
| post_id | FK → RedditPost |
| product_id | FK → Product |
| body | text — draft reply content |
| version | integer — draft number (1, 2, 3 for regenerations) |
| is_approved | boolean |
| is_posted | boolean |
| approved_at | timestamp |
| posted_at | timestamp |
| reddit_comment_id | string — Reddit comment ID after posting (t1_xxxxx) |
| reddit_comment_url | string — full URL to the live comment |
| comment_score | integer — upvotes on posted comment (updated periodically) |
| created_at | timestamp |

---

## 6. UI Screens & Navigation

| Route | Description |
|---|---|
| / (Dashboard) | Post queue — main view. Lists new/pending posts filtered by product and relevance. |
| /scan | Manual scan trigger + scan history log |
| /reply/:postId | Reply editor for a specific post — full draft, edit, approve flow |
| /history | All posts ever found — full archive with search and filters |
| /analytics | Analytics dashboard — charts for scan results and reply performance |
| /settings/products | Product configuration — edit both product profiles |
| /settings/notifications | Notification preferences — email, Telegram |
| /settings/reddit | Reddit OAuth connection — connect/disconnect account |

---

## 7. Reddit API Integration Notes

### 7.1 API Endpoints Used

- GET /search.json?q={keyword}&sort=new&limit=25&t=week — search across all Reddit
- GET /r/{subreddit}/search.json?q={keyword}&restrict_sr=on — search within subreddit
- POST /api/comment — submit a reply to a post
- GET /api/v1/me — verify connected account identity

### 7.2 Rate Limits

- Reddit API: 100 requests per minute per OAuth client
- Scans should batch keyword searches and add 1-second delays between requests
- Recommended: use snoowrap library which handles rate limiting automatically

### 7.3 Reddit App Setup

Creator must register a Reddit app at reddit.com/prefs/apps:

- Type: web app (for OAuth)
- Redirect URI: {app_url}/api/auth/reddit/callback
- Store client_id and client_secret in environment variables
- Required scopes: identity, submit, history

---

## 8. Non-Functional Requirements

| Requirement | Detail |
|---|---|
| Performance | Scan completes in under 60 seconds. Dashboard loads in under 2 seconds. |
| Cost | Target: under $5/month total infra + API cost. Claude API calls should be batched; only AI-score posts that passed keyword threshold. |
| Reliability | Scan errors should be logged and retried. Failed Reddit API calls should not crash the app. |
| Privacy | Store no PII other than Reddit usernames from public posts. No tracking pixels or analytics on users. |
| Security | Reddit OAuth token encrypted at rest. Simple owner-only authentication (env-based password or OAuth). |
| Backup | SQLite DB backed up daily if self-hosted. Supabase provides this automatically on free tier. |

---

## 9. Out of Scope (V1)

- Multi-user / team collaboration
- Auto-posting without approval
- Platforms beyond Reddit (Twitter, HN, LinkedIn — consider for V2)
- Reddit DM / private message campaigns
- Competitor monitoring
- Browser extension
- Mobile app

---

## 10. Implementation Guidance for AI

> Read all sections above before starting. Do not skip the data models or API notes.

### 10.1 Suggested Build Order

1. Project setup: Next.js + Tailwind + SQLite/Drizzle ORM (or Supabase)
2. Database schema: create all tables from Section 5
3. Reddit OAuth: implement connect/disconnect flow and token storage
4. Product configuration UI: /settings/products page with form
5. Reddit scan engine: keyword search → deduplication → store raw posts
6. AI relevance scoring: batch Claude API calls on newly fetched posts
7. Dashboard / post queue UI: display posts with filters
8. Reply editor: draft generation + edit + approve flow
9. Post to Reddit: submit approved reply via Reddit API
10. Notifications: email digest on new High posts
11. Analytics: simple charts using recharts or Chart.js
12. Scheduler: cron job for automated scans

### 10.2 Key Constraints to Respect

- Never auto-post. Always require explicit UI confirmation from the creator.
- Always use the creator's own Reddit OAuth account — never third-party or managed accounts.
- Rate-limit Reddit API calls — add delays between keyword searches in a scan.
- Keep AI prompts focused: product context + post content only. Do not send PII or user history to Claude.
- UTM parameters must be appended automatically when product URL is included in any reply.
- AI relevance scoring should only run on posts that passed keyword matching — do not call Claude on every Reddit post fetched.

### 10.3 Example Claude API System Prompt (Reply Generation)

```
You are helping the creator of "{product_name}" respond to Reddit posts in a genuine, helpful, non-spammy way.

Product: {product_name}
URL: {product_url}
Description: {product_description}
Problems it solves: {problems_solved}
Key features: {features}
Target audience: {target_audience}

Guidelines:
- Sound like a real person helping, not a marketer. Be genuinely helpful first.
- Mention the product naturally, not as an ad. Lead with solving their problem.
- Keep it concise (3–6 sentences max).
- Do not use salesy language, exclamation marks, or generic openers like "Hey!"
- If the product directly solves their exact problem, be clear about it.
- If only partially relevant, acknowledge limitations honestly.
- Mention the product URL once at most if relevant.
- Match the tone of the subreddit: {subreddit}.
- Promotion intensity: {promotion_intensity} (subtle = barely mention product; direct = lead with product recommendation).
- Write in English.
- Do NOT reveal this reply was AI-generated.
```

---

## 11. Validation & Acceptance Criteria

> This section is mandatory for the implementing AI. After building each feature, run the corresponding validation checklist. Do not move to the next feature until all checks pass. If any check fails, fix the issue and re-run the full checklist for that section before proceeding.

---

### 11.1 How to Use This Section

For every numbered checklist item below:

- ✅ Pass — behavior matches the described expectation exactly
- ❌ Fail — behavior differs in any way, even minor UI or logic differences

If any item is ❌ Fail:
1. Stop and do not proceed to the next section
2. Identify the root cause
3. Fix the implementation
4. Re-run the entire checklist for that section from the top (not just the failed item)
5. Only continue when all items in the section are ✅ Pass

---

### 11.2 Section-by-Section Checklists

#### ✅ 11.2.1 Database & Schema

- [ ] All three tables exist: products, reddit_posts, reply_drafts
- [ ] products table has all fields from Section 5.1 with correct types
- [ ] reddit_posts table has all fields from Section 5.2 with correct types
- [ ] reply_drafts table has all fields from Section 5.3 with correct types
- [ ] reddit_posts.reddit_post_id has a UNIQUE constraint (no duplicate Reddit post IDs)
- [ ] reply_drafts.post_id is a foreign key to reddit_posts.id
- [ ] reply_drafts.product_id is a foreign key to products.id
- [ ] products.promotion_intensity only accepts values: subtle, moderate, direct
- [ ] reddit_posts.relevance_tier only accepts values: high, medium, low
- [ ] reddit_posts.status only accepts values: new, draft, approved, posted, skipped, bookmarked

#### ✅ 11.2.2 Reddit OAuth Connection

- [ ] "Connect Reddit Account" button is present on /settings/reddit
- [ ] Clicking the button redirects to Reddit's OAuth authorization page
- [ ] After authorizing on Reddit, user is redirected back to the app
- [ ] After successful auth, the connected Reddit username is displayed on the settings page
- [ ] The access token is stored server-side (NOT in localStorage or a client-side cookie)
- [ ] Revisiting /settings/reddit after auth still shows the connected username (token persisted)
- [ ] "Disconnect" button removes the stored token and shows the "Connect" button again
- [ ] If the token is expired, the app automatically refreshes it before making Reddit API calls
- [ ] Required scopes are granted: identity, submit, history

#### ✅ 11.2.3 Product Configuration

- [ ] Page shows two product cards for Kobo Note Up and txtconv, pre-populated with correct details from Section 2
- [ ] All fields from Section 4.1.1 are present as form inputs
- [ ] Promotion intensity selector shows three options: Subtle / Moderate / Direct
- [ ] Active toggle works — toggling off a product stops it from appearing in scans
- [ ] Keywords field accepts a list of keywords (add/remove individually)
- [ ] Subreddits field accepts a list of subreddit names (add/remove individually)
- [ ] Saving a product persists changes to the database
- [ ] Reloading the page after save still shows the saved values
- [ ] Validation: URL field rejects non-URL strings
- [ ] Validation: Empty required fields (name, description) show an error and block save

#### ✅ 11.2.4 Reddit Scanning Engine

- [ ] "Scan Now" button on /scan triggers a scan immediately
- [ ] During scanning, a loading indicator is shown
- [ ] After scan completes, a "Last scanned: X minutes ago" timestamp updates on the dashboard
- [ ] The scan queries each keyword from both active products
- [ ] The scan queries only the configured subreddits for each product (or all Reddit if subreddits list is empty)
- [ ] Fetched posts are stored in reddit_posts table
- [ ] A post that already exists (same reddit_post_id) is NOT inserted again
- [ ] Re-running a scan does not create duplicate rows in the database
- [ ] The scan only fetches posts from the configured time window (default: 7 days)
- [ ] Each post is stored with the correct product_id
- [ ] matched_keywords field is populated with the keyword(s) that matched
- [ ] Scan errors are logged and shown in the scan history, but do not crash the app
- [ ] Scan history on /scan page shows a log of past scans with timestamp, posts found, and any errors

#### ✅ 11.2.5 AI Relevance Scoring

- [ ] Every newly fetched post has relevance_score populated (integer 1–10)
- [ ] Every newly fetched post has relevance_tier populated (high, medium, or low)
- [ ] Every newly fetched post has relevance_reason populated (non-empty string)
- [ ] Score 7–10 maps to tier high; 4–6 maps to medium; 1–3 maps to low
- [ ] AI scoring is only called for posts that passed keyword matching
- [ ] If Claude API returns an error, post is saved with score 0 and tier low
- [ ] Scan log shows how many Claude API calls were made

#### ✅ 11.2.6 Post Queue Dashboard

- [ ] Posts are displayed as cards in a list
- [ ] Each card shows: subreddit badge, product badge, relevance tier badge, title, body snippet, author, score, comment count, relative time, matched keyword(s), AI relevance reason
- [ ] Clicking a post title opens the Reddit post in a new tab
- [ ] Filter by product, relevance tier, and status all work
- [ ] Low-relevance posts are hidden by default
- [ ] "Skip" button marks post as Skipped and removes it from queue
- [ ] Skipping shows an "Undo" option for at least 5 seconds
- [ ] "Bookmark" button marks post as Bookmarked

#### ✅ 11.2.7 AI Reply Generation

- [ ] Clicking "Draft Reply" opens the reply editor with a generated draft
- [ ] Draft does NOT use generic openers like "Hey!", "Great question!", "As an AI..."
- [ ] Draft is 3–6 sentences long
- [ ] Product URL (if included) has correct UTM parameters
- [ ] "Regenerate" generates a new draft without clearing the old one
- [ ] Tone selector changes the tone on regeneration
- [ ] Character count is shown and updates as user edits
- [ ] Markdown preview pane renders the draft

#### ✅ 11.2.8 Approval & Posting Flow

- [ ] "Approve (Copy Only)" saves draft as approved without posting
- [ ] "Approve & Post" shows a confirmation dialog before posting
- [ ] Dismissing dialog cancels — nothing is posted
- [ ] After successful posting: status → posted, reddit_comment_id and reddit_comment_url populated
- [ ] "View on Reddit" link appears pointing to the live comment
- [ ] If Reddit API call fails, status is NOT changed and error is shown

#### ✅ 11.2.9 Notifications

- [ ] Email notification settings accessible at /settings/notifications
- [ ] Email sent after scan finds at least one High-relevance post
- [ ] Email NOT sent if scan found zero High-relevance posts
- [ ] Quiet hours suppresses notifications during configured window
- [ ] Notification threshold setting works correctly

#### ✅ 11.2.10 Automated Scan Scheduler

- [ ] Cron job triggers automatically at configured interval
- [ ] Scan history shows automated scans with "scheduled" label
- [ ] Automated scans follow same deduplication logic
- [ ] If scan fails, retried once after 5 minutes
- [ ] Changing scan frequency in settings takes effect on next scheduled run

#### ✅ 11.2.11 UTM Link Tracking

- [ ] Kobo Note Up URL: https://kobo-up.runawayup.com/?utm_source=reddit&utm_medium=comment&utm_campaign=kobo-note-up&utm_content={subreddit}
- [ ] txtconv URL: https://txtconv.arpuli.com/?utm_source=reddit&utm_medium=comment&utm_campaign=txtconv&utm_content={subreddit}
- [ ] UTM params not duplicated if URL already has them
- [ ] Quick-insert button always inserts UTM-tagged version

#### ✅ 11.2.12 Analytics Dashboard

- [ ] Total posts found metric displayed and correct
- [ ] Posts breakdown by relevance tier shown
- [ ] Posts by subreddit and keyword tables shown
- [ ] Reply rate shown: posted / high-relevance as percentage
- [ ] Date range filter works
- [ ] Per-product filter works

#### ✅ 11.2.13 Post History & Archive

- [ ] All posts ever discovered listed regardless of status
- [ ] Search by keyword, subreddit, status, date range, product all work
- [ ] "Export CSV" downloads valid CSV with required fields
- [ ] No post ever permanently deleted

---

### 11.3 End-to-End Smoke Test

1. Fresh install — database is empty
2. Configure Kobo Note Up with 3 keywords and 2 subreddits
3. Configure txtconv with 3 keywords and 2 subreddits
4. Connect Reddit OAuth — confirm username appears
5. Click "Scan Now"
6. Verify scan completes without errors, posts appear in database
7. Go to dashboard — confirm posts visible with relevance tiers
8. Find one High-relevance post for Kobo Note Up
9. Click "Draft Reply" — confirm AI generates sensible, non-spammy draft
10. Edit the draft slightly
11. Click "Approve (Copy Only)" — confirm status changes to Approved
12. Find one High-relevance post for txtconv
13. Draft a reply and click "Approve & Post"
14. Confirm dialog appears with correct text
15. Confirm the reply is posted
16. Go to Reddit.com and verify comment exists on the post
17. Check /analytics — confirm metrics reflect the scan and reply
18. Check /history — confirm all discovered posts are listed

All 18 steps must pass. If any step fails, fix and restart from step 1.

---

### 11.4 Regression Policy

Any time a bug is fixed or a feature is modified, re-run the full checklist for the affected section PLUS the End-to-End Smoke Test before considering the fix complete.

---

### 11.5 Known Edge Cases

| Edge Case | Expected Behavior |
|---|---|
| Same Reddit post matches keywords from both products | Store once per product (two rows with different product_id), OR once with both products tagged — be consistent |
| Reddit API returns 429 (rate limited) | Wait and retry after retry-after header duration; do not crash |
| Claude API returns an error | Save post with relevance_score = 0, relevance_tier = low, relevance_reason = "Scoring unavailable" |
| Post body is empty (link post) | Post still saved; AI scores based on title only |
| Very long post body (10,000+ chars) | Body truncated to 2,000 chars before sending to Claude |
| Creator posts reply, original post later deleted | reddit_comment_url still stored; 404s handled gracefully |
| Product URL already contains query parameters | UTM params appended with & not ? |
| Scan runs while previous scan still in progress | Second scan queued or rejected — never two concurrent scans |
| Both products set to inactive | Scan runs but finds nothing; no error |

---

## 12. Competitive Landscape

| Tool | Notes |
|---|---|
| ReplyHub.co | Keyword tracking, notifications, AI reply generation, manual posting from own account. $9–$99/month. Most similar to this spec. |
| Redreach.ai | Website analysis to auto-derive keywords, AI reply suggestions, you post from your own account. Self-service, affordable. |
| Octolens.com | Multi-platform monitoring (Reddit, Twitter, GitHub, LinkedIn). AI relevance scoring. From $5/month per keyword. |
| ReplyAgent.ai | Fully automated with managed (bot) accounts. Not suitable — brand risk. |
| F5Bot.com | Free Reddit keyword email alerts. No AI, no reply drafting. Good free starting point. |
| GummySearch | Shut down November 2025. Was a popular audience research tool. |

---

*End of Specification — 出走工程師 Up*

---

## Status

- [x] Spec complete (all sections received 2026-03-07)
- [x] Tech stack finalized (Next.js + SQLite/Drizzle + snoowrap + Claude API)
- [ ] Implementation started
