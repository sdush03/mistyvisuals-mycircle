'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Footer from '@/components/Footer'

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  useEffect(() => {
    // Unregister any active service worker to clean up previous PWA installation
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister().then((success) => {
            if (success) {
              console.log('Successfully unregistered old service worker.')
            }
          })
        }
      }).catch((err) => {
        console.error('Failed to unregister service worker:', err)
      })
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Never redirect legal compliance pages
    if (pathname === '/terms' || pathname === '/privacy' || pathname === '/refund') {
      return
    }

    const ua = navigator.userAgent || ''
    const isTouchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
    const isIOS = /iPad|iPhone|iPod/.test(ua) || isTouchMac
    const isAndroid = /Android/i.test(ua)

    if (isIOS) {
      window.location.replace('https://apps.apple.com/app/id6796633077')
    } else if (isAndroid) {
      window.location.replace('https://play.google.com/store/apps/details?id=com.mistyvisuals.mycircle')
    }
  }, [pathname])

  // The splash screen has a custom dark background and no footer
  const isSplash = pathname && /^\/[^/]+\/gallery\/?$/.test(pathname)

  if (isSplash) {
    return (
      <main className="w-full h-[100svh] bg-[#111111] overflow-hidden">
        {children}
      </main>
    )
  }

  return (
    <main className="w-full min-h-screen bg-white overflow-y-auto flex flex-col justify-between">
      <div className="flex-1 w-full">{children}</div>
      <Footer />
    </main>
  )
}
