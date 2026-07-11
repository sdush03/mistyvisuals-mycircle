export type RouteState = {
  activeTab?: string
  scrollY?: number
  scrollX?: number
  timestamp?: number
}

const STALE_MS = 30 * 60 * 1000
const INTENT_KEY = 'scroll:restore:intent'
const RELOAD_KEY = 'scroll:restore:reload'
const NAV_KEY = 'scroll:restore:nav'

const normalizeTargetKey = (target?: string) => {
  if (!target || typeof window === 'undefined') {
    return window.location.pathname
  }
  try {
    const url = new URL(target, window.location.origin)
    return url.pathname
  } catch {
    if (target.startsWith('/')) return target.split('?')[0] || target
    return `/${target}`.split('?')[0]
  }
}

export const getRouteStateKey = (path?: string) => {
  if (!path && typeof window !== 'undefined') {
    return `routeState:${window.location.pathname}`
  }
  return `routeState:${path || ''}`
}

export const readRouteState = (key: string): RouteState | null => {
  if (!key || typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RouteState
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.timestamp && Date.now() - parsed.timestamp > STALE_MS) return null
    return parsed
  } catch {
    return null
  }
}

export const writeRouteState = (key: string, next: RouteState) => {
  if (!key || typeof window === 'undefined') return
  const current = readRouteState(key) || {}
  const payload = {
    ...current,
    ...next,
    timestamp: Date.now(),
  }
  sessionStorage.setItem(key, JSON.stringify(payload))
}

export const markScrollRestore = (targetPath?: string) => {
  if (typeof window === 'undefined') return
  try {
    const payload = { ts: Date.now(), key: normalizeTargetKey(targetPath) }
    sessionStorage.setItem(INTENT_KEY, JSON.stringify(payload))
  } catch {}
}

export const markReload = () => {
  if (typeof window === 'undefined') return
  try {
    const payload = { ts: Date.now(), path: window.location.pathname }
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify(payload))
  } catch {}
}

export const shouldRestoreScroll = () => {
  if (typeof window === 'undefined') return false
  const nowKey = window.location.pathname
  try {
    const raw = sessionStorage.getItem(INTENT_KEY)
    if (raw) {
      let ts = 0
      let targetKey = ''
      try {
        const parsed = JSON.parse(raw) as { ts?: number; key?: string }
        ts = Number(parsed?.ts || 0)
        targetKey = String(parsed?.key || '')
      } catch {
        clearRestoreIntent()
        return false
      }
      if (Number.isNaN(ts) || Date.now() - ts > STALE_MS) {
        clearRestoreIntent()
        return false
      }
      if (targetKey && targetKey !== nowKey) {
        clearRestoreIntent()
        return false
      }
      return true
    }
  } catch {}
  try {
    const rawReload = sessionStorage.getItem(RELOAD_KEY)
    if (rawReload) {
      try {
        const parsed = JSON.parse(rawReload) as { ts?: number; path?: string }
        const ts = Number(parsed?.ts || 0)
        const path = String(parsed?.path || '')
        sessionStorage.removeItem(RELOAD_KEY)
        if (!Number.isNaN(ts) && Date.now() - ts < 5000 && path === nowKey) {
          return true
        }
      } catch {
        sessionStorage.removeItem(RELOAD_KEY)
      }
    }
  } catch {}
  try {
    const navRaw = sessionStorage.getItem(NAV_KEY)
    if (navRaw) {
      try {
        const parsed = JSON.parse(navRaw) as { ts?: number; path?: string; origin?: number }
        const ts = Number(parsed?.ts || 0)
        const path = String(parsed?.path || '')
        const origin = Number(parsed?.origin || 0)
        const currentOrigin = Number(
          typeof performance !== 'undefined' ? (performance as any).timeOrigin || 0 : 0
        )
        if (origin && currentOrigin && origin !== currentOrigin) {
          sessionStorage.removeItem(NAV_KEY)
        } else {
          if (!Number.isNaN(ts) && Date.now() - ts < 2000 && path === nowKey) {
            return true
          }
          return false
        }
      } catch {}
    }
    const nav = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
    const type = nav?.type
    let shouldRestore = type === 'reload' || type === 'back_forward'
    if (!type) {
      const legacy = (performance as any).navigation?.type
      shouldRestore = legacy === 1 || legacy === 2
    }
    if (shouldRestore) {
      const origin = Number(
        typeof performance !== 'undefined' ? (performance as any).timeOrigin || 0 : 0
      )
      sessionStorage.setItem(
        NAV_KEY,
        JSON.stringify({ ts: Date.now(), path: nowKey, origin })
      )
    }
    return shouldRestore
  } catch {
    try {
      const legacy = (performance as any).navigation?.type
      const shouldRestore = legacy === 1 || legacy === 2
      if (shouldRestore) {
        const origin = Number(
          typeof performance !== 'undefined' ? (performance as any).timeOrigin || 0 : 0
        )
        sessionStorage.setItem(
          NAV_KEY,
          JSON.stringify({ ts: Date.now(), path: nowKey, origin })
        )
      }
      return shouldRestore
    } catch {
      return false
    }
  }
}

export const clearRestoreIntent = () => {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(INTENT_KEY)
    sessionStorage.removeItem(RELOAD_KEY)
  } catch {}
}
