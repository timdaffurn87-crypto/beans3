'use client'

import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'

const items = [
  { href: '/my-roster', label: 'My Roster', desc: 'View your upcoming shifts', icon: '📅' },
  { href: '/invoice', label: 'Scan Invoice', desc: 'Capture delivery receipts', icon: '📄' },
  { href: '/recipes', label: 'Recipe Book', desc: 'Browse recipes', icon: '📖' },
  { href: '/eod', label: 'End of Day', desc: 'Submit shift report', icon: '🌙' },
]

const managerItems = [
  { href: '/results', label: '7-Day Results', desc: 'Performance overview', icon: '📊' },
  { href: '/admin/menu', label: 'Menu Management', desc: 'Add & edit menu items', icon: '📋' },
  { href: '/admin/tasks', label: 'Task Templates', desc: 'Manage task templates', icon: '⚙' },
  { href: '/admin/settings', label: 'Settings', desc: 'Staff & café config', icon: '🔧' },
]

/** More screen — additional navigation for features not in the main bottom tab bar */
export default function MorePage() {
  const { profile } = useAuth()
  const isManager = profile?.role === 'manager' || profile?.role === 'owner'

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#FAF8F3' }}>
      <div className="px-5 pt-12 pb-6">
        <h1 className="text-2xl font-bold text-[#1A1A1A]">More</h1>
      </div>
      <div className="px-5 space-y-2">
        {items.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center bg-white rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-transform"
          >
            <span className="text-2xl mr-4 w-8 text-center">{item.icon}</span>
            <div className="flex-1">
              <p className="font-semibold text-[#1A1A1A]">{item.label}</p>
              <p className="text-sm text-gray-400">{item.desc}</p>
            </div>
            <span className="text-gray-300 text-lg">›</span>
          </Link>
        ))}
        {isManager && (
          <>
            <p className="section-label pt-2">Management</p>
            {managerItems.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center bg-white rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-transform"
              >
                <span className="text-2xl mr-4 w-8 text-center">{item.icon}</span>
                <div className="flex-1">
                  <p className="font-semibold text-[#1A1A1A]">{item.label}</p>
                  <p className="text-sm text-gray-400">{item.desc}</p>
                </div>
                <span className="text-gray-300 text-lg">›</span>
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
