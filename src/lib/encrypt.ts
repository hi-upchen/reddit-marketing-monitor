import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

// Derive a 32-byte key from the ENCRYPTION_KEY env var using scrypt
function getDerivedKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY env var not set')
  // Use a fixed salt (non-secret) — the key itself provides the entropy
  return scryptSync(raw, 'rmm-salt-v1', 32)
}

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12   // 96-bit IV for GCM

export function encrypt(plaintext: string): string {
  const key = getDerivedKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: iv(hex):tag(hex):encrypted(hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(ciphertext: string): string {
  const key = getDerivedKey()
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Invalid ciphertext format')
  const [ivHex, tagHex, encHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const encrypted = Buffer.from(encHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}
