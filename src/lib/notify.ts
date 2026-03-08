import { db } from '@/db'
import { appSettings } from '@/db/schema'
import { eq } from 'drizzle-orm'

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
  telegramEnabled: boolean
  telegramBotToken: string
  telegramChatId: string
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
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, 'notification_settings'))
  if (!rows.length) return null
  return JSON.parse(rows[0].value) as NotificationSettings
}

async function sendTelegram(botToken: string, chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Telegram API error: ${err}`)
  }
}

async function sendEmailDigest(settings: NotificationSettings, posts: NotifiablePost[]) {
  if (!settings.email) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const html = `
    <h2>Reddit Marketing Monitor — ${posts.length} new relevant post${posts.length > 1 ? 's' : ''}</h2>
    ${posts.map(p => `
      <div style="border:1px solid #eee;padding:12px;margin:8px 0;border-radius:6px">
        <strong>r/${p.subreddit}</strong> &nbsp;
        <span style="background:${p.relevanceTier === 'high' ? '#dcfce7' : '#fef9c3'};padding:2px 6px;border-radius:4px;font-size:12px">${p.relevanceTier}</span><br/>
        <a href="${p.url}" style="font-weight:600">${p.title}</a><br/>
        <em style="color:#666">${p.relevanceReason}</em><br/>
        <a href="${appUrl}/reply/${p.id}">Draft Reply →</a>
      </div>
    `).join('')}
  `
  const subject = `[RMM] ${posts.length} new Reddit post${posts.length > 1 ? 's' : ''} to reply to`

  if (!process.env.RESEND_API_KEY) {
    console.log('[notify] RESEND_API_KEY not set. Would send email:')
    console.log(`To: ${settings.email} | Subject: ${subject}`)
    console.log(`Posts: ${posts.map(p => p.title).join(', ')}`)
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
  console.log(`[notify] Email sent to ${settings.email}`)
}

export async function sendNewPostsNotification(posts: NotifiablePost[]) {
  if (!posts.length) return

  const settings = await getNotificationSettings()
  if (!settings) return

  if (isQuietHours(settings.quietStart || '23:00', settings.quietEnd || '08:00')) {
    console.log('[notify] Quiet hours active, suppressing notification')
    return
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // Email digest
  if (settings.email) {
    try {
      await sendEmailDigest(settings, posts)
    } catch (e) {
      console.error('[notify] Email send failed:', e)
    }
  }

  // Telegram: send per-post if frequency=immediate, or digest if frequency=digest
  if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
    try {
      if (settings.frequency === 'immediate') {
        for (const post of posts) {
          const text = `🔴 <b>New ${post.relevanceTier} match</b>\n<b>r/${post.subreddit}</b>\n<a href="${post.url}">${post.title}</a>\n<i>${post.relevanceReason}</i>\n\n<a href="${appUrl}/reply/${post.id}">Draft Reply →</a>`
          await sendTelegram(settings.telegramBotToken, settings.telegramChatId, text)
        }
      } else {
        // Digest: one message with all posts
        const lines = posts.map(p =>
          `• <b>r/${p.subreddit}</b> [${p.relevanceTier}]\n  <a href="${p.url}">${p.title}</a>`
        ).join('\n\n')
        const text = `📊 <b>RMM: ${posts.length} new post${posts.length > 1 ? 's' : ''}</b>\n\n${lines}\n\n<a href="${appUrl}">Open Dashboard →</a>`
        await sendTelegram(settings.telegramBotToken, settings.telegramChatId, text)
      }
      console.log(`[notify] Telegram sent for ${posts.length} post(s)`)
    } catch (e) {
      console.error('[notify] Telegram send failed:', e)
    }
  }
}
