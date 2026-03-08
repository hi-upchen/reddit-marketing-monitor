'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface NotificationSettings {
  email: string
  threshold: string
  frequency: string
  quietStart: string
  quietEnd: string
  telegramEnabled: boolean
  telegramBotToken: string
  telegramChatId: string
}

export default function NotificationsSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings>({
    email: '',
    threshold: 'high',
    frequency: 'digest',
    quietStart: '23:00',
    quietEnd: '08:00',
    telegramEnabled: false,
    telegramBotToken: '',
    telegramChatId: '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings/notifications').then(r => r.json()).then(setSettings)
  }, [])

  function set<K extends keyof NotificationSettings>(field: K, value: NotificationSettings[K]) {
    setSettings(s => ({ ...s, [field]: value }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    const res = await fetch('/api/settings/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaving(false)
    if (res.ok) setSaved(true)
  }

  return (
    <div className="max-w-lg mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Notification Settings</h1>

      <Card>
        <CardHeader><CardTitle>Email Notifications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Notification Email</Label>
            <Input type="email" value={settings.email} onChange={e => set('email', e.target.value)} placeholder="your@email.com" />
            <p className="text-xs text-muted-foreground">Email to notify when new relevant posts are found.</p>
          </div>

          <div className="space-y-1">
            <Label>Relevance Threshold</Label>
            <Select value={settings.threshold} onValueChange={v => v && set('threshold', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High only</SelectItem>
                <SelectItem value="high,medium">High + Medium</SelectItem>
                <SelectItem value="all">All (including Low)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Minimum relevance tier to trigger a notification.</p>
          </div>

          <div className="space-y-1">
            <Label>Notification Frequency</Label>
            <Select value={settings.frequency} onValueChange={v => v && set('frequency', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="digest">Per-scan digest (one email per scan)</SelectItem>
                <SelectItem value="immediate">Immediate (one email per post)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Quiet Hours Start</Label>
              <Input type="time" value={settings.quietStart} onChange={e => set('quietStart', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Quiet Hours End</Label>
              <Input type="time" value={settings.quietEnd} onChange={e => set('quietEnd', e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Notifications are suppressed during quiet hours (UTC).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Telegram Notifications (Optional)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Switch checked={settings.telegramEnabled} onCheckedChange={v => set('telegramEnabled', v)} />
            <Label>Enable Telegram notifications</Label>
          </div>

          {settings.telegramEnabled && (
            <>
              <div className="space-y-1">
                <Label>Bot Token</Label>
                <Input
                  type="password"
                  value={settings.telegramBotToken}
                  onChange={e => set('telegramBotToken', e.target.value)}
                  placeholder="123456:ABC-DEF..."
                />
                <p className="text-xs text-muted-foreground">
                  Get from <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="underline">@BotFather</a> on Telegram.
                </p>
              </div>
              <div className="space-y-1">
                <Label>Chat ID</Label>
                <Input
                  value={settings.telegramChatId}
                  onChange={e => set('telegramChatId', e.target.value)}
                  placeholder="Your chat ID or group ID"
                />
                <p className="text-xs text-muted-foreground">
                  Send a message to your bot, then check <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
        {saved && <span className="text-sm text-green-600">✅ Saved</span>}
      </div>
    </div>
  )
}
