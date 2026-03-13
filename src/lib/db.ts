import { createClient, type InArgs, type Row } from '@libsql/client'

// Validate required env vars at module load time (fails fast with a clear message)
if (!process.env.TURSO_DATABASE_URL) {
  throw new Error(
    '[db] TURSO_DATABASE_URL is not set. ' +
    'Add it to .env.local (local dev) or your Vercel environment variables.'
  )
}
if (!process.env.TURSO_AUTH_TOKEN) {
  throw new Error(
    '[db] TURSO_AUTH_TOKEN is not set. ' +
    'Add it to .env.local (local dev) or your Vercel environment variables.'
  )
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

export async function query<T = Row>(sql: string, args: InArgs = []): Promise<T[]> {
  const result = await client.execute({ sql, args })
  return result.rows as T[]
}

export async function execute(
  sql: string,
  args: InArgs = []
): Promise<{ rowsAffected: number; lastInsertRowid?: bigint }> {
  const result = await client.execute({ sql, args })
  return { rowsAffected: result.rowsAffected, lastInsertRowid: result.lastInsertRowid }
}

export { client }
