'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'

const BARISTA_TABS = [
  { href: '/', label: 'Dashboard', icon: '⊞' },
  { href: '/calibration', label: 'Calibrate', icon: '☕' },
  { href: '/waste', label: 'Waste', icon: '🗑' },
  { href: '/tasks', label: 'Tasks', icon: '✓' },
  { href: '/more', label: 'More', icon: '⋯' },
]

const MANAGER_TABS = [
  { href: '/', label: 'Dashboard', icon: '⊞' },
  { href: '/calibration', label: 'Calibrate', icon: '☕' },
  { href: '/waste', label: 'Waste', icon: '🗑' },
  { href: '/tasks', label: 'Tasks', icon: '✓' },
  { href: '/more', label: 'More', icon: '⋯' },
]

/** Role-aware bottom navigation bar — shown on all authenticated screens */
export function BottomNav() {
  const pathname = usePathname()
  const { profile } = useAuth()

  // Hide bottom nav on login screen
  if (!profile || pathname === '/login') return null

  const tabs = profile.role === 'barista' ? BARISTA_TABS : MANAGER_TABS

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white border-t border-gray-100 z-40">
      <div className="flex items-stretch">
        {tabs.map(tab => {
          const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center py-3 gap-0.5 min-h-[60px] transition-colors',
                isActive ? 'text-[#B8960C]' : 'text-gray-400'
              )}
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              <span className={cn('text-[10px] font-medium', isActive && 'font-semibold')}>
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
