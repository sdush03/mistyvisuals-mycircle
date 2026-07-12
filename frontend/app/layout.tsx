import './globals.css'
import type { Metadata } from 'next'
import ScrollRestoration from '@/components/ScrollRestoration'
import LayoutWrapper from '@/components/LayoutWrapper'

export const metadata: Metadata = {
  title: 'My Circle | Misty Visuals',
  description: 'Discover your wedding photos and matched celebrations.',
  icons: {
    icon: '/icons/icon-192x192-v3.png',
    shortcut: '/icons/icon-192x192-v3.png',
    apple: '/icons/icon-512x512-v3.png',
  },
  verification: {
    google: '58t2nxviEH1qsoDN8yItjYB3QRnmnJ-VuvRFAXX5GvI',
  },
}

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f4f0' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-[var(--background)] text-[var(--foreground)]">
        <ScrollRestoration />
        <LayoutWrapper>
          {children}
        </LayoutWrapper>
      </body>
    </html>
  )
}
