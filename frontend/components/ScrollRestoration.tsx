'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { clearRestoreIntent, markReload, markScrollRestore, shouldRestoreScroll } from '@/lib/routeState'

const keyFor = (path: string) => `scroll:${path}`

export default function ScrollRestoration() {
  const pathname = usePathname()
  const prevPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPopState = () => markScrollRestore()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onBeforeUnload = () => markReload()
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('pagehide', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onBeforeUnload)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'manual'
      }
    } catch {}
    const key = keyFor(pathname)

    const scroller = document.getElementById('app-scroll')
    if (!scroller) return

    const shouldRestore = shouldRestoreScroll()
    const saved = shouldRestore ? sessionStorage.getItem(key) : null
    let restoreTimer: number | null = null
    let clearTimer: number | null = null
    if (saved) {
      const target = Number(saved)
      if (!Number.isNaN(target)) {
        const start = Date.now()
        const maxWaitMs = 8000
        const restore = () => {
          const maxScroll = scroller.scrollHeight - scroller.clientHeight
          const canReach = maxScroll >= target
          const y = Math.max(0, Math.min(target, maxScroll))
          scroller.scrollTo(0, y)
          const done = canReach && Math.abs(scroller.scrollTop - y) <= 2
          if (!done && Date.now() - start < maxWaitMs) {
            restoreTimer = window.setTimeout(restore, 160)
          } else if (shouldRestore) {
            clearRestoreIntent()
          }
        }
        requestAnimationFrame(restore)
      } else if (shouldRestore) {
        clearRestoreIntent()
      }
    } else if (shouldRestore) {
      clearTimer = window.setTimeout(() => {
        clearRestoreIntent()
      }, 800)
    } else {
      if (prevPathRef.current && prevPathRef.current !== pathname) {
        scroller.scrollTo(0, 0)
      }
    }
    prevPathRef.current = pathname

    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const value = String(scroller.scrollTop || 0)
        sessionStorage.setItem(key, value)
        ticking = false
      })
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    sessionStorage.setItem('scroll:last', key)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (restoreTimer) window.clearTimeout(restoreTimer)
      if (clearTimer) window.clearTimeout(clearTimer)
    }
  }, [pathname])

  return null
}
