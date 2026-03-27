'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithPin } from '@/lib/auth'
import { cn } from '@/lib/cn'

/** PIN Login screen — phone lock screen style */
export default function LoginPage() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [shake, setShake] = useState(false)
  const [isFirstLaunch, setIsFirstLaunch] = useState(false)
  const [checkingFirstLaunch, setCheckingFirstLaunch] = useState(true)
  const router = useRouter()

  // Check if any staff exist (first launch detection).
  // Uses the API route so the check runs with service role and bypasses RLS —
  // the profiles table is only readable by authenticated users, so a direct
  // client-side query from an unauthenticated visitor would always return 0.
  useEffect(() => {
    async function checkFirstLaunch() {
      try {
        const res = await fetch('/api/setup')
        const data = await res.json()
        setIsFirstLaunch(data.isFirstLaunch === true)
      } catch {
        setIsFirstLaunch(false)
      }
      setCheckingFirstLaunch(false)
    }
    checkFirstLaunch()
  }, [])

  const triggerShake = useCallback(() => {
    setShake(true)
    setTimeout(() => setShake(false), 600)
  }, [])

  function handleDigit(digit: string) {
    if (pin.length >= 6) return
    setError('')
    setPin(prev => prev + digit)
  }

  function handleDelete() {
    setPin(prev => prev.slice(0, -1))
    setError('')
  }

  const handleSubmit = useCallback(async () => {
    if (pin.length < 4) {
      setError('PIN must be 4–6 digits')
      triggerShake()
      return
    }

    setLoading(true)
    const profile = await signInWithPin(pin)
    setLoading(false)

    if (!profile) {
      setError('Invalid PIN')
      triggerShake()
      setPin('')
      return
    }

    router.push('/')
  }, [pin, router, triggerShake])

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (pin.length === 6) {
      handleSubmit()
    }
  }, [pin, handleSubmit])

  if (checkingFirstLaunch) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isFirstLaunch) {
    return <FirstLaunchSetup onComplete={() => setIsFirstLaunch(false)} />
  }

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: '#FAF8F3' }}>
      {/* Logo */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-[#1A1A1A]">BEANS</h1>
        <p className="text-sm text-gray-400 mt-1">Cocoa Café Operations</p>
      </div>

      {/* PIN dots */}
      <div
        className="flex gap-4 mb-4"
        style={shake ? { animation: 'shake 0.5s ease-in-out' } : undefined}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'w-4 h-4 rounded-full border-2 transition-all',
              i < pin.length
                ? 'bg-[#B8960C] border-[#B8960C]'
                : 'border-gray-300 bg-transparent'
            )}
          />
        ))}
      </div>

      {/* Error */}
      <p className={cn('text-sm text-red-500 h-5 mb-4', !error && 'invisible')}>
        {error || 'placeholder'}
      </p>

      {/* Number pad */}
      <div className="grid grid-cols-3 gap-4 w-full max-w-[280px]">
        {digits.map((digit, i) => {
          if (digit === '') return <div key={i} />

          const isDelete = digit === '⌫'
          return (
            <button
              key={i}
              onClick={isDelete ? handleDelete : () => handleDigit(digit)}
              className={cn(
                'h-16 rounded-2xl text-xl font-semibold transition-all active:scale-90',
                isDelete
                  ? 'bg-transparent text-gray-400 text-2xl'
                  : 'bg-white shadow-sm text-[#1A1A1A] hover:bg-gray-50 active:bg-gray-100'
              )}
              disabled={loading}
            >
              {digit}
            </button>
          )
        })}
      </div>

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={pin.length < 4 || loading}
        className="mt-6 w-full max-w-[280px] py-4 rounded-full bg-[#B8960C] text-white font-semibold text-base disabled:opacity-40 active:scale-95 transition-all"
      >
        {loading ? 'Signing in…' : 'Sign In'}
      </button>
    </div>
  )
}

/** First-launch setup screen to create the owner account */
function FirstLaunchSetup({ onComplete }: { onComplete: () => void }) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required'); return }
    if (pin.length < 4) { setError('PIN must be 4–6 digits'); return }
    if (pin !== confirmPin) { setError('PINs do not match'); return }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin, role: 'owner' }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Setup failed')
        setLoading(false)
        return
      }

      onComplete()
    } catch {
      setError('Setup failed — check your internet connection')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: '#FAF8F3' }}>
      <div className="w-full max-w-[340px]">
        <h1 className="text-3xl font-bold text-[#1A1A1A] mb-1">Welcome to Beans</h1>
        <p className="text-gray-500 mb-8">Set up your owner account to get started.</p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Your name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Tim"
              className="px-4 py-3 rounded-xl border border-gray-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Choose a PIN (4–6 digits)</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="px-4 py-3 rounded-xl border border-gray-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Confirm PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="px-4 py-3 rounded-xl border border-gray-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-[#B8960C]"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full py-4 rounded-full bg-[#B8960C] text-white font-semibold disabled:opacity-40"
          >
            {loading ? 'Creating account…' : 'Create Owner Account'}
          </button>
        </div>
      </div>
    </div>
  )
}
