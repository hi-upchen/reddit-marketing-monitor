export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateStartupSecrets } = await import('@/lib/auth')
    validateStartupSecrets()

    // Ensure sessions table exists (auto-migration)
    const { execute } = await import('@/lib/db')
    await execute(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`, []).catch(e => {
      console.error('[db] Failed to create sessions table:', e)
    })

    // Clean up expired sessions on startup
    await execute(
      `DELETE FROM sessions WHERE expires_at < datetime('now')`,
      []
    ).catch(() => {})

    // Migrate reply_drafts: check if table has the correct schema (variant column + correct FK)
    // Only drop+recreate if the old broken schema is detected (missing variant column)
    const { query } = await import('@/lib/db')
    const hasVariant = await query<{ name: string }>(
      `SELECT name FROM pragma_table_info('reply_drafts') WHERE name = 'variant'`, []
    ).catch(() => [])

    if (hasVariant.length === 0) {
      // Table either doesn't exist or has old schema — safe to recreate
      await execute(`DROP TABLE IF EXISTS reply_drafts`, []).catch(() => {})
    }

    await execute(`CREATE TABLE IF NOT EXISTS reply_drafts (
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
    )`, []).catch(e => {
      console.error('[db] Failed to create reply_drafts table:', e)
    })
  }
}
