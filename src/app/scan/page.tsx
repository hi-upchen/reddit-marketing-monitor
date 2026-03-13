'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RefreshCw } from 'lucide-react'

interface ScanLog {
  id: string
  triggeredBy: string
  status: string
  postsFound: number
  newPosts: number
  claudeCalls: number
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

interface ScanSettings {
  intervalHours: number
  daysBack: number
  lastScanAt: string | null
  lastScanNew: number | null
}

export default function ScanPage() {
  const [logs, setLogs] = useState<ScanLog[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<ScanSettings>({ intervalHours: 3, daysBack: 7, lastScanAt: null, lastScanNew: null })
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  async function loadData() {
    const [logsRes, settingsRes] = await Promise.all([
      fetch('/api/scan/history'),
      fetch('/api/settings/scan'),
    ])
    setLogs(await logsRes.json())
    setSettings(await settingsRes.json())
    setLoading(false)
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/scan/history').then(r => r.json()),
      fetch('/api/settings/scan').then(r => r.json()),
    ]).then(([logsData, settingsData]) => {
      setLogs(logsData)
      setSettings(settingsData)
      setLoading(false)
    }).catch(() => {})
  }, [])

  async function scanNow() {
    setScanning(true)
    setScanError(null)
    try {
      const res = await fetch('/api/scan', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setScanError(data.error ?? 'Scan failed'); setScanning(false); return }
      // Poll with increasing intervals: 5s, 10s, 15s, then every 15s
      let attempt = 0
      const poll = async () => {
        attempt++
        const logs: ScanLog[] = await fetch('/api/scan/history').then(r => r.json())
        setLogs(logs)
        const latest = logs[0]
        if (!latest || latest.status === 'completed' || latest.status === 'failed') {
          setScanning(false)
          if (latest?.status === 'failed' && latest.errorMessage) setScanError(latest.errorMessage)
          fetch('/api/settings/scan').then(r => r.json()).then(setSettings).catch(() => {})
        } else {
          const delay = Math.min(attempt * 5000, 15000)
          setTimeout(poll, delay)
        }
      }
      setTimeout(poll, 5000)
    } catch {
      setScanError('Network error'); setScanning(false)
    }
  }

  async function saveSettings() {
    setSavingSettings(true)
    await fetch('/api/settings/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalHours: settings.intervalHours, daysBack: settings.daysBack }),
    })
    setSavingSettings(false)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 3000)
  }

  const formatTime = (iso: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
  }

  const statusColor = (status: string) => {
    if (status === 'completed') return 'default'
    if (status === 'failed') return 'destructive'
    return 'secondary'
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Scan</h1>
        <Button onClick={scanNow} disabled={scanning}>
          <RefreshCw size={14} className={`mr-1 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Scanning...' : 'Scan Now'}
        </Button>
      </div>

      {scanning && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-700 flex items-center gap-2">
          <RefreshCw size={14} className="animate-spin shrink-0" />
          Scanning Reddit… this can take up to 60 seconds.
        </div>
      )}
      {scanError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          {scanError}
        </div>
      )}

      {settings.lastScanAt && (
        <p className="text-sm text-muted-foreground">
          Last completed scan: <strong>{formatTime(settings.lastScanAt)}</strong>
          {settings.lastScanNew !== null && ` · ${settings.lastScanNew} new posts`}
        </p>
      )}

      {/* Scan Settings */}
      <Card className="overflow-visible">
        <CardHeader><CardTitle>Scan Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4 overflow-visible">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Scan Frequency</Label>
              <Select
                value={String(settings.intervalHours)}
                onValueChange={v => setSettings(s => ({ ...s, intervalHours: Number(v) }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Every hour</SelectItem>
                  <SelectItem value="3">Every 3 hours</SelectItem>
                  <SelectItem value="6">Every 6 hours</SelectItem>
                  <SelectItem value="12">Every 12 hours</SelectItem>
                  <SelectItem value="24">Daily</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">How often to auto-scan Reddit.</p>
            </div>
            <div className="space-y-1">
              <Label>Look-back Window</Label>
              <Select
                value={String(settings.daysBack)}
                onValueChange={v => setSettings(s => ({ ...s, daysBack: Number(v) }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="14">Last 14 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="60">Last 60 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">How far back to search for posts.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={saveSettings} disabled={savingSettings} size="sm">
              {savingSettings ? 'Saving...' : 'Save Settings'}
            </Button>
            {settingsSaved && <span className="text-sm text-green-600">✅ Saved (takes effect on next scan)</span>}
          </div>
        </CardContent>
      </Card>

      {/* Scan History */}
      <div>
        <h2 className="font-semibold mb-3">Scan History</h2>
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : logs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No scans yet. Click &quot;Scan Now&quot; to start.</p>
        ) : (
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="border rounded p-3 flex flex-wrap gap-2 items-center text-sm">
                <Badge variant={log.triggeredBy === 'manual' ? 'secondary' : 'outline'}>
                  {log.triggeredBy}
                </Badge>
                <Badge variant={statusColor(log.status) as 'default' | 'destructive' | 'secondary'}>
                  {log.status}
                </Badge>
                <span className="text-muted-foreground">{formatTime(log.startedAt)}</span>
                <span>{log.newPosts} new posts</span>
                <span className="text-muted-foreground">{log.claudeCalls} AI calls</span>
                {log.errorMessage && (
                  <span className="text-red-500 text-xs">{log.errorMessage}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
