'use client'

import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Shows a banner prompting users to install the app to their home screen.
 * Uses the beforeinstallprompt event (Chrome/Android).
 * For iOS, shows a manual instruction banner.
 * Only shows once — dismissed state stored in localStorage.
 */
export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSPrompt, setShowIOSPrompt] = useState(false)
  const [dismissed, setDismissed] = useState(true) // start hidden, reveal after check

  useEffect(() => {
    // Don't show if already dismissed
    if (localStorage.getItem('pwa-install-dismissed')) return

    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return

    // Check iOS
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isInStandaloneMode =
      ('standalone' in window.navigator) &&
      (window.navigator as { standalone?: boolean }).standalone

    if (isIOS && !isInStandaloneMode) {
      setShowIOSPrompt(true)
      setDismissed(false)
      return
    }

    // Android/Chrome: listen for install prompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setDismissed(false)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function handleDismiss() {
    localStorage.setItem('pwa-install-dismissed', '1')
    setDismissed(true)
    setDeferredPrompt(null)
    setShowIOSPrompt(false)
  }

  async function handleInstall() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      handleDismiss()
    }
  }

  if (dismissed) return null

  // iOS manual instructions
  if (showIOSPrompt) {
    return (
      <div className="fixed bottom-20 left-4 right-4 max-w-[390px] mx-auto bg-[#1A1A1A] text-white rounded-2xl p-4 shadow-2xl z-50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-sm mb-1">Install Beans</p>
            <p className="text-xs text-gray-300 leading-relaxed">
              Tap the Share button <span className="inline-block">⬆</span> then &ldquo;Add to Home Screen&rdquo; to install the app.
            </p>
          </div>
          <button onClick={handleDismiss} className="text-gray-400 text-xl leading-none flex-shrink-0">×</button>
        </div>
      </div>
    )
  }

  // Android/Chrome install prompt
  return (
    <div className="fixed bottom-20 left-4 right-4 max-w-[390px] mx-auto bg-[#1A1A1A] text-white rounded-2xl p-4 shadow-2xl z-50">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-sm mb-0.5">Install Beans</p>
          <p className="text-xs text-gray-300">Add to your home screen for quick access</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={handleDismiss} className="text-xs text-gray-400 px-3 py-2">Not now</button>
          <button
            onClick={handleInstall}
            className="text-xs bg-[#B8960C] text-white px-4 py-2 rounded-full font-semibold"
          >
            Install
          </button>
        </div>
      </div>
    </div>
  )
}
