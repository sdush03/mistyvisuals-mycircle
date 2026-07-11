'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { getAuth } from '@/lib/authClient'

export default function SessionHeartbeat() {
  const pathname = usePathname()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRef = useRef(false)

  const sendHeartbeat = (event: 'open' | 'ping', keepalive = false) => {
    try {
      fetch('/api/auth/heartbeat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
        keepalive,
      }).catch(() => {})
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (pathname && pathname.includes('/gallery')) return
    let mounted = true

    const start = async () => {
      const auth = await getAuth()
      if (!mounted || !auth?.authenticated) return
      activeRef.current = true
      sendHeartbeat('open')
      intervalRef.current = setInterval(() => {
        sendHeartbeat('ping')
      }, 2 * 60 * 1000)
    }

    start()

    const onVisibility = () => {
      if (!activeRef.current) return
      if (document.visibilityState === 'hidden') {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        return
      }

      sendHeartbeat('open')
      if (!intervalRef.current) {
        intervalRef.current = setInterval(() => {
          sendHeartbeat('ping')
        }, 2 * 60 * 1000)
      }
    }

    window.addEventListener('visibilitychange', onVisibility)

    return () => {
      mounted = false
      activeRef.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      window.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pathname])

  return null
}
