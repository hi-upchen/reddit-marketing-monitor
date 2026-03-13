# Reply Drafts Redesign: 3 Suggestions + User Prompt

**Date:** 2026-03-13
**Status:** Approved

## Problem

1. **FK bug:** `reply_drafts.product_id` references `reddit_posts(id)` instead of `products(id)`, causing SQLITE_CONSTRAINT errors when generating drafts.
2. **Single draft UX:** Current flow generates one draft at a time. User wants 3 variations to choose from, optionally guided by a user-provided prompt.

## Design

### DB Schema Fix

Migration in `src/instrumentation.ts`:

```sql
DROP TABLE IF EXISTS reply_drafts;
CREATE TABLE reply_drafts (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES reddit_posts(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  variant INTEGER NOT NULL DEFAULT 1,
  is_approved INTEGER NOT NULL DEFAULT 0,
  is_posted INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT,
  posted_at TEXT,
  reddit_comment_id TEXT,
  reddit_comment_url TEXT,
  comment_score INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_id, version, variant)
)
```

Changes:
- `product_id` FK now references `products(id)` (was `reddit_posts(id)`)
- Added `variant` column (1, 2, or 3) to distinguish suggestions within a version
- Added UNIQUE constraint on `(post_id, version, variant)`

Migration: Drop and recreate table (no production data to preserve).

### API: POST `/api/posts/[id]/draft`

**Request body:** `{ prompt?: string }`

**Behavior:**
- Fetch post and product from DB (unchanged)
- Determine 3 generation configs:
  - If `prompt` provided: run 3 calls with different angle instructions appended to differentiate output:
    - Variant 1: "Write a concise, direct reply"
    - Variant 2: "Write a warm, detailed reply"
    - Variant 3: "Write the reply as a personal experience"
  - If no `prompt`: run 3 calls with preset tones: `["helpful", "technical", "personal story"]`
- Use `Promise.allSettled` — save and return whatever succeeds (1-3 drafts). If all 3 fail, return 500.
- Save drafts to DB with same `version`, `variant` 1/2/3
- Update post status to `'draft'`
- Return array of draft objects

**Tone dropdown:** Removed. When no prompt, the 3 preset tones provide variety. When prompt is provided, the 3 angle instructions provide variety.

### API: GET `/api/posts/[id]/draft`

Returns flat array of all drafts with `variant` field included, ordered by `version DESC, variant ASC`. Frontend groups by `version` client-side.

### AI: `generateReplyDraft` in `src/lib/ai.ts`

Add optional `userPrompt` parameter:

```typescript
export async function generateReplyDraft(
  product: { ... },
  post: { title: string; body: string; subreddit: string },
  tone?: string,
  userPrompt?: string
): Promise<string>
```

When `userPrompt` is provided, append to the system instruction:
```
<user_guidance>{userPrompt}</user_guidance>
Incorporate the guidance above naturally into your reply.
```

Wrapped in XML tags for consistency with the rest of the prompt injection mitigation pattern.

### Frontend: `src/app/reply/[postId]/page.tsx`

**New UI flow:**

1. **Prompt input** (optional): Text input above the generate button. Placeholder: "Optional: guide the AI (e.g. 'mention the free browser version', 'focus on the export problem')"
2. **Generate button**: "Generate 3 Suggestions" — sends prompt (if any) to API
3. **Suggestions display**: 3 cards in a column layout, each showing:
   - Label: "Suggestion 1", "Suggestion 2", "Suggestion 3"
   - Full draft text (scrollable)
   - "Use This" button
4. **Selection**: Clicking "Use This" loads that draft into the existing editor textarea, sets `currentDraftId`
5. **Editor + actions**: Unchanged — edit, preview, approve/copy, approve/post. Only the selected variant is approved/posted.

**State changes:**
- Remove `tone` state and tone dropdown
- Add `suggestions: Draft[]` state for the 3 cards
- Add `userPrompt: string` state for the input
- Update `Draft` interface to include `variant: number`
- Previous versions: show as "v1", "v2" etc. Clicking loads the 3 variants of that version into suggestions.

### Files Changed

1. `src/instrumentation.ts` — drop + recreate reply_drafts table with corrected schema
2. `src/app/api/posts/[id]/draft/route.ts` — return 3 drafts via Promise.allSettled, accept prompt, remove tone
3. `src/lib/ai.ts` — add userPrompt parameter to generateReplyDraft
4. `src/app/reply/[postId]/page.tsx` — 3 suggestion cards, prompt input, remove tone dropdown

## Out of Scope

- Streaming/SSE for draft generation progress
- Saving user prompts for reuse
- Customizing which 3 preset tones are used
