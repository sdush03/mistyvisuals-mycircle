'use client'

import { useEffect } from 'react'

export default function SessionWatchdog() {
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
            window.location.href = '/'
          }
        }
      } catch (_) {
        // Network offline — keep existing local UI
      }
    }

    const onFocus = () => {
      checkSession()
    }
    window.addEventListener('focus', onFocus)

    // Check every 10 seconds while desktop browser tab is open
    const interval = setInterval(checkSession, 10000)

    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [])

  return null
}
