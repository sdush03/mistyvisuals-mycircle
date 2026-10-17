'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export default function SessionWatchdog() {
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === 'undefined') return

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''

    const checkSession = async () => {
      const circleToken = localStorage.getItem('mv_circle_token')
      if (!circleToken) return

      try {
        const res = await fetch(`${apiUrl}/api/gallery/family/session-check`, {
          headers: { Authorization: `Bearer ${circleToken}` }
        })

        if (res.status === 401 || res.status === 403) {
          console.warn('[SessionWatchdog] Desktop session terminated on another device. Logging out...')

          if ((window as any).google?.accounts?.id) {
            try {
              ;(window as any).google.accounts.id.disableAutoSelect()
            } catch (_) {}
          }

          // Clear all circle and gallery session data from localStorage
          localStorage.removeItem('mv_circle_token')
          localStorage.removeItem('mv_circle_profile')
          const keysToRemove: string[] = []
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key?.startsWith('mv_gallery_token_') || key?.startsWith('mv_gallery_guest_')) {
              keysToRemove.push(key)
            }
          }
          keysToRemove.forEach((k) => localStorage.removeItem(k))

          // Notify any listening components on the page (e.g. homepage state)
          window.dispatchEvent(new Event('mv_session_expired'))

          // If on a gallery or inner page, immediately return to homepage
          if (window.location.pathname !== '/') {
            window.location.replace('/')
          }
        }
      } catch (_) {
        // Network offline — keep existing local UI
      }
    }

    // Check immediately on mount and whenever route/pathname changes
    checkSession()

    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        checkSession()
      }
    }

    window.addEventListener('focus', onFocusOrVisible)
    document.addEventListener('visibilitychange', onFocusOrVisible)

    // Check every 5 seconds while desktop browser tab is open
    const interval = setInterval(checkSession, 5000)

    return () => {
      window.removeEventListener('focus', onFocusOrVisible)
      document.removeEventListener('visibilitychange', onFocusOrVisible)
      clearInterval(interval)
    }
  }, [pathname])

  return null
}
