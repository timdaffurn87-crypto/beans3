'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { generatePin } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { logActivity } from '@/lib/activity'
import type { Profile } from '@/lib/types'

/** Settings page — Staff management (all managers/owners), Café config + API keys + Targets (owner only) */
export default function SettingsPage() {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()
  const [staff, setStaff] = useState<Profile[]>([])
  const [loadingStaff, setLoadingStaff] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Café config state
  const [ownerEmail, setOwnerEmail] = useState('')
  const [cafeDayStart, setCafeDayStart] = useState('05:30')
  const [cafeDayEnd, setCafeDayEnd] = useState('15:00')
  const [tillFloat, setTillFloat] = useState('200.00')
  const [savingConfig, setSavingConfig] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(true)

  // API key state
  const [claudeKeyConfigured, setClaudeKeyConfigured] = useState(false)
  const [claudeKeyInput, setClaudeKeyInput] = useState('')
  const [savingClaudeKey, setSavingClaudeKey] = useState(false)
  const [showClaudeKeyInput, setShowClaudeKeyInput] = useState(false)

  const [geminiKeyConfigured, setGeminiKeyConfigured] = useState(false)
  const [geminiKeyInput, setGeminiKeyInput] = useState('')
  const [savingGeminiKey, setSavingGeminiKey] = useState(false)
  const [showGeminiKeyInput, setShowGeminiKeyInput] = useState(false)

  // Xero integration state
  const [xeroConnected, setXeroConnected] = useState(false)
  const [xeroLastSync, setXeroLastSync] = useState<string | null>(null)
  const [disconnectingXero, setDisconnectingXero] = useState(false)
  const [xeroStatusLoading, setXeroStatusLoading] = useState(true)

  // Targets state
  const [targetWaste, setTargetWaste] = useState('50')
  const [targetTasks, setTargetTasks] = useState('90')
  const [targetCal, setTargetCal] = useState('100')
  const [savingTargets, setSavingTargets] = useState(false)

  // Auth guard
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
    if (!loading && profile && profile.role === 'barista') router.push('/')
  }, [profile, loading, router])

  async function fetchStaff() {
    const supabase = createClient()
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true })
    setStaff(data ?? [])
    setLoadingStaff(false)
  }

  /** Fetch owner-only settings on mount */
  async function fetchOwnerSettings() {
    const supabase = createClient()

    const { data: settingsData } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', [
        'owner_email',
        'cafe_day_start',
        'cafe_day_end',
        'till_float',
        'target_daily_waste',
        'target_task_completion',
        'target_calibration_compliance',
      ])

    const map: Record<string, string> = {}
    for (const s of settingsData ?? []) {
      map[s.key] = s.value
    }

    if (map['owner_email']) setOwnerEmail(map['owner_email'])
    if (map['cafe_day_start']) setCafeDayStart(map['cafe_day_start'])
    if (map['cafe_day_end']) setCafeDayEnd(map['cafe_day_end'])
    if (map['till_float']) setTillFloat(map['till_float'])
    if (map['target_daily_waste']) setTargetWaste(map['target_daily_waste'])
    if (map['target_task_completion']) setTargetTasks(map['target_task_completion'])
    if (map['target_calibration_compliance']) setTargetCal(map['target_calibration_compliance'])

    // Check which AI keys are configured (count-only — never read the actual values client-side)
    const { data: keyRows } = await supabase
      .from('settings')
      .select('key')
      .in('key', ['claude_api_key', 'gemini_api_key'])

    const configuredKeys = new Set((keyRows ?? []).map(r => r.key))
    setClaudeKeyConfigured(configuredKeys.has('claude_api_key'))
    setGeminiKeyConfigured(configuredKeys.has('gemini_api_key'))
    setLoadingConfig(false)
  }

  /** Fetch Xero connection status from the server (queries xero_tokens via service role) */
  async function fetchXeroStatus() {
    setXeroStatusLoading(true)
    try {
      const res = await fetch('/api/xero/status')
      if (res.ok) {
        const data = await res.json()
        setXeroConnected(data.connected)
        setXeroLastSync(data.lastSync ?? null)
      }
    } finally {
      setXeroStatusLoading(false)
    }
  }

  // Show toast from Xero OAuth callback redirect params
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const xero = params.get('xero')
    if (xero === 'connected') {
      showToast('Xero connected successfully', 'success')
      // Clean up URL
      window.history.replaceState({}, '', '/admin/settings')
    } else if (xero === 'cancelled') {
      showToast('Xero connection cancelled', 'error')
      window.history.replaceState({}, '', '/admin/settings')
    } else if (xero === 'error') {
      showToast('Xero connection failed — check your credentials', 'error')
      window.history.replaceState({}, '', '/admin/settings')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (profile) {
      fetchStaff()
      if (profile.role === 'owner') {
        fetchOwnerSettings()
        fetchXeroStatus()
      } else {
        setLoadingConfig(false)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  /** Upsert a single setting key/value. Returns true on success. */
  async function upsertSetting(key: string, value: string): Promise<boolean> {
    const supabase = createClient()
    const { error } = await supabase
      .from('settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) {
      showToast(`Failed to save setting: ${error.message}`, 'error')
      return false
    }
    return true
  }

  /** Save café configuration */
  async function handleSaveConfig() {
    if (!profile) return
    setSavingConfig(true)
    const supabase = createClient()

    const upserts = [
      { key: 'owner_email', value: ownerEmail.trim(), updated_at: new Date().toISOString() },
      { key: 'cafe_day_start', value: cafeDayStart, updated_at: new Date().toISOString() },
      { key: 'cafe_day_end', value: cafeDayEnd, updated_at: new Date().toISOString() },
      { key: 'till_float', value: (parseFloat(tillFloat) || 0).toFixed(2), updated_at: new Date().toISOString() },
    ]

    const { error } = await supabase
      .from('settings')
      .upsert(upserts, { onConflict: 'key' })

    setSavingConfig(false)

    if (error) {
      showToast(error.message, 'error')
      return
    }

    await logActivity(profile.id, 'settings_updated', 'Updated café configuration')
    showToast('Configuration saved', 'success')
  }

  /** Save the Gemini API key */
  async function handleSaveGeminiKey() {
    if (!geminiKeyInput.trim()) {
      showToast('Enter a valid API key', 'error')
      return
    }
    setSavingGeminiKey(true)
    const ok = await upsertSetting('gemini_api_key', geminiKeyInput.trim())
    setSavingGeminiKey(false)
    if (!ok) return
    setGeminiKeyConfigured(true)
    setShowGeminiKeyInput(false)
    setGeminiKeyInput('')
    showToast('Gemini API key saved', 'success')
  }

  /** Save the Claude API key */
  async function handleSaveClaudeKey() {
    if (!claudeKeyInput.trim()) {
      showToast('Enter a valid API key', 'error')
      return
    }
    setSavingClaudeKey(true)
    const ok = await upsertSetting('claude_api_key', claudeKeyInput.trim())
    setSavingClaudeKey(false)
    if (!ok) return
    setClaudeKeyConfigured(true)
    setShowClaudeKeyInput(false)
    setClaudeKeyInput('')
    showToast('API key saved', 'success')
  }

  /** Disconnects Xero by deleting the xero_tokens row directly from the client */
  async function handleDisconnectXero() {
    setDisconnectingXero(true)
    const supabase = createClient()
    const { error } = await supabase.from('xero_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    setDisconnectingXero(false)
    if (error) { showToast(error.message, 'error'); return }
    setXeroConnected(false)
    setXeroLastSync(null)
    showToast('Xero disconnected', 'success')
  }

  /** Save performance targets */
  async function handleSaveTargets() {
    if (!profile) return
    const waste = parseFloat(targetWaste)
    const tasks = parseFloat(targetTasks)
    const cal = parseFloat(targetCal)

    if (isNaN(waste) || waste < 0) { showToast('Enter a valid waste limit', 'error'); return }
    if (isNaN(tasks) || tasks < 0 || tasks > 100) { showToast('Tasks target must be 0–100', 'error'); return }
    if (isNaN(cal) || cal < 0 || cal > 100) { showToast('Calibration target must be 0–100', 'error'); return }

    setSavingTargets(true)
    const supabase = createClient()

    const upserts = [
      { key: 'target_daily_waste', value: waste.toString(), updated_at: new Date().toISOString() },
      { key: 'target_task_completion', value: tasks.toString(), updated_at: new Date().toISOString() },
      { key: 'target_calibration_compliance', value: cal.toString(), updated_at: new Date().toISOString() },
    ]

    const { error } = await supabase
      .from('settings')
      .upsert(upserts, { onConflict: 'key' })

    setSavingTargets(false)

    if (error) {
      showToast(error.message, 'error')
      return
    }

    showToast('Targets saved', 'success')
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isOwner = profile.role === 'owner'

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <button onClick={() => router.back()} className="text-[#B8960C] text-sm mb-3 flex items-center gap-1">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Settings</h1>
      </div>

      <div className="px-5 space-y-6">

        {/* ── Staff Management ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">Staff</p>
            {isOwner && (
              <button
                onClick={() => setShowAddForm(v => !v)}
                className="text-sm font-semibold text-[#B8960C]"
              >
                {showAddForm ? 'Cancel' : '+ Add Staff'}
              </button>
            )}
          </div>

          {/* Add staff form */}
          {showAddForm && isOwner && (
            <AddStaffForm
              onSuccess={(name, role) => {
                setShowAddForm(false)
                fetchStaff()
                showToast('Staff member added', 'success')
                if (profile) logActivity(profile.id, 'staff_added', `Added staff member: ${name} (${role})`)
              }}
              onError={(msg) => showToast(msg, 'error')}
              isOwner={isOwner}
            />
          )}

          {/* Staff list */}
          {loadingStaff ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {staff.map(member => (
                <StaffCard
                  key={member.id}
                  member={member}
                  currentUserId={profile.id}
                  isOwner={isOwner}
                  isEditing={editingId === member.id}
                  onEdit={() => setEditingId(member.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onUpdated={() => { setEditingId(null); fetchStaff(); showToast('Updated', 'success') }}
                  onError={(msg) => showToast(msg, 'error')}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Owner-only sections ── */}
        {isOwner && !loadingConfig && (
          <>
            {/* ── Café Configuration ── */}
            <div>
              <p className="section-label mb-3">Café Configuration</p>
              <div className="bg-white rounded-2xl p-4 space-y-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Owner Email</label>
                  <input
                    type="email"
                    value={ownerEmail}
                    onChange={e => setOwnerEmail(e.target.value)}
                    placeholder="owner@example.com"
                    className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
                  />
                  <p className="text-xs text-gray-400">EOD reports will be emailed to this address</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700">Café Day Start</label>
                    <input
                      type="time"
                      value={cafeDayStart}
                      onChange={e => setCafeDayStart(e.target.value)}
                      className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700">Café Day End</label>
                    <input
                      type="time"
                      value={cafeDayEnd}
                      onChange={e => setCafeDayEnd(e.target.value)}
                      className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Till Float</label>
                  <p className="text-xs text-gray-400">Opening cash in the till each day. EOD auto-flags a discrepancy if cash count doesn&apos;t match.</p>
                  <div className="relative mt-1">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={tillFloat}
                      onChange={e => setTillFloat(e.target.value)}
                      placeholder="200.00"
                      className="w-full pl-8 pr-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
                    />
                  </div>
                </div>

                <button
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
                >
                  {savingConfig ? 'Saving…' : 'Save Configuration'}
                </button>
              </div>
            </div>

            {/* ── API Keys ── */}
            <div>
              <p className="section-label mb-3">API Keys</p>
              <div className="bg-white rounded-2xl p-4 space-y-4">

                {/* Claude API Key */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="font-medium text-[#1A1A1A] text-sm">Claude API Key</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Used for invoice AI extraction and menu scanning
                      </p>
                    </div>
                    {claudeKeyConfigured && !showClaudeKeyInput && (
                      <button
                        onClick={() => setShowClaudeKeyInput(true)}
                        className="text-sm font-medium text-[#B8960C] shrink-0"
                      >
                        Update
                      </button>
                    )}
                  </div>

                  {claudeKeyConfigured && !showClaudeKeyInput ? (
                    <div className="flex items-center gap-2 px-4 py-3 bg-green-50 rounded-xl">
                      <span className="text-xs font-medium text-[#16A34A]">API key configured</span>
                      <span className="text-[#16A34A] text-sm">✓</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={claudeKeyInput}
                        onChange={e => setClaudeKeyInput(e.target.value)}
                        placeholder="sk-ant-…"
                        className="w-full px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861] font-mono text-sm"
                      />
                      <div className="flex gap-2">
                        {claudeKeyConfigured && (
                          <button
                            onClick={() => { setShowClaudeKeyInput(false); setClaudeKeyInput('') }}
                            className="flex-1 py-2.5 rounded-full border border-gray-200 text-gray-600 text-sm font-medium"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          onClick={handleSaveClaudeKey}
                          disabled={savingClaudeKey}
                          className="flex-1 py-2.5 rounded-full bg-[#B8960C] text-white font-semibold text-sm disabled:opacity-40"
                        >
                          {savingClaudeKey ? 'Saving…' : 'Save Key'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>


                {/* Gemini API Key — fallback for invoice extraction */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="font-medium text-[#1A1A1A] text-sm">Gemini API Key</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Backup AI for invoice scanning if Claude is unavailable
                      </p>
                    </div>
                    {geminiKeyConfigured && !showGeminiKeyInput && (
                      <button
                        onClick={() => setShowGeminiKeyInput(true)}
                        className="text-sm font-semibold text-[#B8960C] shrink-0"
                      >
                        Update
                      </button>
                    )}
                  </div>

                  {geminiKeyConfigured && !showGeminiKeyInput ? (
                    <div className="flex items-center gap-2 px-4 py-3 bg-green-50 rounded-xl">
                      <span className="text-xs font-medium text-[#16A34A]">API key configured</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={geminiKeyInput}
                        onChange={e => setGeminiKeyInput(e.target.value)}
                        placeholder="AIzaSy…"
                        className="w-full px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
                      />
                      <div className="flex gap-2">
                        {geminiKeyConfigured && (
                          <button
                            onClick={() => { setShowGeminiKeyInput(false); setGeminiKeyInput('') }}
                            className="flex-1 py-2.5 rounded-full border border-gray-200 text-gray-600 text-sm font-medium"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          onClick={handleSaveGeminiKey}
                          disabled={savingGeminiKey}
                          className="flex-1 py-2.5 rounded-full bg-[#B8960C] text-white font-semibold text-sm disabled:opacity-40"
                        >
                          {savingGeminiKey ? 'Saving…' : 'Save Key'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* ── Xero Integration ── */}
            <div>
              <p className="section-label mb-3">Xero Integration</p>
              <div className="bg-white rounded-2xl p-4 space-y-4">

                {/* Connection status — display-only, setup is done via Edge Function */}
                {xeroStatusLoading ? (
                  <div className="flex justify-center py-4">
                    <div className="w-5 h-5 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : xeroConnected ? (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 px-4 py-3 bg-green-50 rounded-xl flex-1 mr-3">
                        <span className="text-[#16A34A] text-sm">✓</span>
                        <div>
                          <span className="text-xs font-medium text-[#16A34A]">Connected to Xero</span>
                          {xeroLastSync && (
                            <p className="text-xs text-green-600 mt-0.5">
                              Last sync: {new Date(xeroLastSync).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'short', timeStyle: 'short' })}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={handleDisconnectXero}
                        disabled={disconnectingXero}
                        className="px-4 py-3 rounded-xl border border-red-200 text-red-500 text-sm font-medium disabled:opacity-40 whitespace-nowrap"
                      >
                        {disconnectingXero ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400">
                      Invoices sync to Xero automatically via cron at 3:00 PM AEST each day.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl">
                      <span className="text-gray-400 text-sm">○</span>
                      <span className="text-xs text-gray-500 font-medium">Not connected</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      Connect your Xero account to automatically sync invoices each day at 3:00 PM.
                    </p>
                    <a
                      href="/api/xero/connect"
                      className="block w-full py-3 rounded-xl text-center text-sm font-semibold text-white"
                      style={{ background: 'linear-gradient(135deg, #296861 0%, #73b0a8 100%)' }}
                    >
                      Connect Xero Account
                    </a>
                  </div>
                )}


              </div>
            </div>

            {/* ── Performance Targets ── */}
            <div>
              <p className="section-label mb-3">Performance Targets</p>
              <div className="bg-white rounded-2xl p-4 space-y-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Daily Waste Limit ($)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={targetWaste}
                    onChange={e => setTargetWaste(e.target.value)}
                    placeholder="50"
                    className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Task Completion Target (%)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={targetTasks}
                    onChange={e => setTargetTasks(e.target.value)}
                    placeholder="90"
                    className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Calibration Compliance Target (%)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={targetCal}
                    onChange={e => setTargetCal(e.target.value)}
                    placeholder="100"
                    className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
                  />
                </div>
                <button
                  onClick={handleSaveTargets}
                  disabled={savingTargets}
                  className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
                >
                  {savingTargets ? 'Saving…' : 'Save Targets'}
                </button>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

/** Form to add a new staff member */
function AddStaffForm({
  onSuccess,
  onError,
  isOwner,
}: {
  onSuccess: (name: string, role: string) => void
  onError: (msg: string) => void
  isOwner: boolean
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<'barista' | 'manager' | 'owner'>('barista')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    if (!name.trim()) { onError('Name is required'); return }
    if (!/^\d{4,6}$/.test(pin)) { onError('PIN must be 4–6 digits'); return }

    setLoading(true)
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), role, pin }),
    })
    setLoading(false)

    if (!res.ok) {
      const data = await res.json()
      onError(data.error || 'Failed to add staff')
      return
    }

    onSuccess(name.trim(), role)
  }

  return (
    <div className="bg-white rounded-2xl p-4 mb-3 space-y-3">
      <h3 className="font-semibold text-[#1A1A1A]">New Staff Member</h3>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Full name"
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Role</label>
        <select
          value={role}
          onChange={e => setRole(e.target.value as 'barista' | 'manager' | 'owner')}
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        >
          <option value="barista">Barista</option>
          <option value="manager">Manager</option>
          {isOwner && <option value="owner">Owner</option>}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">PIN</label>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="4–6 digits"
            className="flex-1 px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
          />
          <button
            type="button"
            onClick={() => setPin(generatePin())}
            className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-sm text-[#B8960C] font-medium whitespace-nowrap"
          >
            Generate
          </button>
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
      >
        {loading ? 'Adding…' : 'Add Staff Member'}
      </button>
    </div>
  )
}

/** Single staff card with inline edit capability */
function StaffCard({
  member,
  currentUserId,
  isOwner,
  isEditing,
  onEdit,
  onCancelEdit,
  onUpdated,
  onError,
}: {
  member: Profile
  currentUserId: string
  isOwner: boolean
  isEditing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onUpdated: () => void
  onError: (msg: string) => void
}) {
  const [name, setName] = useState(member.full_name)
  const [role, setRole] = useState(member.role)
  const [pin, setPin] = useState(member.pin)
  const [isActive, setIsActive] = useState(member.is_active)
  const [loading, setLoading] = useState(false)

  const isSelf = member.id === currentUserId
  const roleBadgeColor =
    member.role === 'owner'
      ? 'bg-[#B8960C]/10 text-[#B8960C]'
      : member.role === 'manager'
      ? 'bg-blue-50 text-blue-600'
      : 'bg-gray-100 text-gray-500'

  async function handleUpdate() {
    if (!name.trim()) { onError('Name is required'); return }
    if (!/^\d{4,6}$/.test(pin)) { onError('PIN must be 4–6 digits'); return }

    setLoading(true)
    const res = await fetch(`/api/staff/${member.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        role: isSelf ? undefined : role, // can't change own role
        pin,
        is_active: isSelf ? undefined : isActive,
      }),
    })
    setLoading(false)

    if (!res.ok) {
      const data = await res.json()
      onError(data.error || 'Update failed')
      return
    }

    onUpdated()
  }

  if (!isEditing) {
    return (
      <div className="bg-white rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#B8960C]/10 flex items-center justify-center">
              <span className="text-[#B8960C] font-bold text-sm">
                {member.full_name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="font-semibold text-[#1A1A1A]">{member.full_name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadgeColor}`}>
                  {member.role}
                </span>
                {!member.is_active && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-500 font-medium">
                    Inactive
                  </span>
                )}
                <span className="text-xs text-gray-400">PIN: {'•'.repeat(member.pin.length)}</span>
              </div>
            </div>
          </div>
          {isOwner && (
            <button onClick={onEdit} className="text-[#B8960C] text-sm font-medium">
              Edit
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-4 space-y-3 border-2 border-[#B8960C]/20">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[#1A1A1A]">Edit {member.full_name}</h3>
        <button onClick={onCancelEdit} className="text-gray-400 text-sm">Cancel</button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
        />
      </div>

      {!isSelf && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Role</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value as Profile['role'])}
            className="px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
          >
            <option value="barista">Barista</option>
            <option value="manager">Manager</option>
            {isOwner && <option value="owner">Owner</option>}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">PIN</label>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            className="flex-1 px-4 py-3 rounded-xl bg-[#f1ede7] border-0 border-b-2 border-transparent text-base focus:outline-none focus:border-[#296861]"
          />
          <button
            type="button"
            onClick={() => setPin(generatePin())}
            className="px-4 py-3 rounded-xl border border-gray-200 bg-[#FAF8F3] text-sm text-[#B8960C] font-medium whitespace-nowrap"
          >
            Generate
          </button>
        </div>
      </div>

      {!isSelf && (
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="font-medium text-[#1A1A1A] text-sm">Active</p>
            <p className="text-xs text-gray-400">Inactive staff cannot log in</p>
          </div>
          <button
            onClick={() => setIsActive(v => !v)}
            className={`w-12 h-6 rounded-full transition-colors relative ${isActive ? 'bg-[#16A34A]' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${isActive ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      )}

      <button
        onClick={handleUpdate}
        disabled={loading}
        className="w-full py-3 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
      >
        {loading ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  )
}
