import type { Metadata, Viewport } from 'next'
import { Inter, Playfair_Display, Newsreader } from 'next/font/google'
import './globals.css'
import { ToastProvider } from '@/components/ui/Toast'
import { BottomNav } from '@/components/BottomNav'
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt'

/**
 * Inter — body font. Clean, modern sans-serif for all data, labels and UI copy.
 * Loaded as the default className so it applies everywhere automatically.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

/**
 * Playfair Display — heading font used across the main app.
 * Exposed as --font-playfair; globals.css applies it to h1/h2.
 */
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  weight: ['400', '600', '700'],
  display: 'swap',
})

/**
 * Newsreader — editorial serif with beautiful italic styles.
 * Used in the invoice screen for large display headings.
 * Exposed as --font-newsreader for per-screen use.
 */
const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Beans',
  description: 'Cocoa Café Operations',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Beans',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#FAF8F3',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Material Symbols — icon font used on the invoice screen */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
      </head>
      {/* All font variables injected here so CSS can reference them globally.
          inter.className sets Inter as the default body font. */}
      <body
        className={`${inter.className} ${inter.variable} ${playfair.variable} ${newsreader.variable}`}
        style={{ backgroundColor: '#FAF8F3', minHeight: '100vh' }}
      >
        <ToastProvider>
          <main className="max-w-[430px] mx-auto min-h-screen pb-20">
            {children}
          </main>
          <BottomNav />
          <PWAInstallPrompt />
        </ToastProvider>
      </body>
    </html>
  )
}
