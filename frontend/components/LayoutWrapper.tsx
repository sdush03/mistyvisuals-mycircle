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
