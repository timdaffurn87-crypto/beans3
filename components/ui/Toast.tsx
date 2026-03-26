'use client'

import { useState, createContext, useContext, useCallback } from 'react'
import { cn } from '@/lib/cn'

interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

interface ToastContextValue {
  showToast: (message: string, type?: Toast['type']) => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

/** Provider that enables toast notifications throughout the app */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[calc(100%-2rem)] max-w-[390px]">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={cn(
              'px-4 py-3 rounded-xl text-white text-sm font-medium shadow-lg',
              toast.type === 'success' && 'bg-[#16A34A]',
              toast.type === 'error' && 'bg-[#DC2626]',
              toast.type === 'info' && 'bg-[#1A1A1A]',
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/** Hook to trigger toast notifications */
export function useToast() {
  return useContext(ToastContext)
}
