import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import path from 'path'
import fs from 'fs'

// Global singleton to survive Next.js hot-reload in development
// Without this, each module re-import opens a new SQLite connection
declare global {
  // eslint-disable-next-line no-var
  var __rmmDb: ReturnType<typeof drizzle> | undefined
}

function createDb() {
  const dataDir = path.join(process.cwd(), 'data')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = path.join(dataDir, 'rmm.db')
  const sqlite = new Database(dbPath)

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  return drizzle(sqlite, { schema })
}

// Re-use existing connection in development to avoid hot-reload issues
export const db = globalThis.__rmmDb ?? createDb()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__rmmDb = db
}

export * from './schema'
