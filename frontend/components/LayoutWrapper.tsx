'use client'

import { usePathname } from 'next/navigation'
import Footer from '@/components/Footer'

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

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
