import { query } from '@/lib/db'

interface NotifiablePost {
  id: string
  title: string
  subreddit: string
  url: string
  relevanceReason: string
  relevanceTier: string
}

interface NotificationSettings {
  email: string
  threshold: 'high' | 'high,medium' | 'all'
  frequency: 'digest' | 'immediate'
  quietStart: string
  quietEnd: string
}

function isQuietHours(quietStart: string, quietEnd: string): boolean {
  const now = new Date()
  const [sh, sm] = quietStart.split(':').map(Number)
  const [eh, em] = quietEnd.split(':').map(Number)
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes()
  const startMins = sh * 60 + sm
  const endMins = eh * 60 + em
  if (startMins > endMins) return nowMins >= startMins || nowMins < endMins
  return nowMins >= startMins && nowMins < endMins
}

async function getNotificationSettings(): Promise<NotificationSettings | null> {
  const rows = await query<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    ['notification_settings']
  )
  if (!rows.length) return null
  return JSON.parse(rows[0].value) as NotificationSettings
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sendEmailDigest(settings: NotificationSettings, posts: NotifiablePost[]) {
  if (!settings.email) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const html = `
    <h2>Reddit Marketing Monitor — ${posts.length} new relevant post${posts.length > 1 ? 's' : ''}</h2>
    ${posts.map(p => `
      <div style="border:1px solid #eee;padding:12px;margin:8px 0;border-radius:6px">
        <strong>r/${escapeHtml(p.subreddit)}</strong> &nbsp;
        <span style="background:${p.relevanceTier === 'high' ? '#dcfce7' : '#fef9c3'};padding:2px 6px;border-radius:4px;font-size:12px">${escapeHtml(p.relevanceTier)}</span><br/>
        <a href="${escapeHtml(p.url)}" style="font-weight:600">${escapeHtml(p.title)}</a><br/>
        <em style="color:#666">${escapeHtml(p.relevanceReason)}</em><br/>
        <a href="${appUrl}/reply/${escapeHtml(p.id)}">Draft Reply →</a>
      </div>
    `).join('')}
  `
  const subject = `[RMM] ${posts.length} new Reddit post${posts.length > 1 ? 's' : ''} to reply to`

  if (!process.env.RESEND_API_KEY) {
    console.log('[notify] RESEND_API_KEY not set. Would send email:')
    console.log(`To: ${settings.email} | Subject: ${subject}`)
    return
  }

  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: settings.email,
    subject,
    html,
  })
}

export async function sendNewPostsNotification(posts: NotifiablePost[]) {
  if (!posts.length) return

  const settings = await getNotificationSettings()
  if (!settings) return

  if (isQuietHours(settings.quietStart || '23:00', settings.quietEnd || '08:00')) return

  if (settings.email) {
    try { await sendEmailDigest(settings, posts) } catch (e) { console.error('[notify] Email failed:', e) }
  }
}
