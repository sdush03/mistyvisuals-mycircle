type AuthUser = {
  id?: number
  email?: string
  role?: string
  roles?: string[]
  name?: string | null
  nickname?: string | null
  job_title?: string | null
  has_photo?: boolean
  has_signature?: boolean
  force_password_reset?: boolean
  is_active?: boolean
}

export type AuthResponse = {
  authenticated: boolean
  is_impersonated?: boolean
  user?: AuthUser
}

type AuthCache = {
  data: AuthResponse | null
  ts: number
  promise: Promise<AuthResponse | null> | null
}

const CACHE_TTL_MS = 2 * 60 * 1000
const UNAUTH_TTL_MS = 15 * 1000

const getCache = (): AuthCache => {
  if (typeof window === 'undefined') {
    return { data: null, ts: 0, promise: null }
  }
  const w = window as typeof window & { __MV_AUTH_CACHE__?: AuthCache }
  if (!w.__MV_AUTH_CACHE__) {
    w.__MV_AUTH_CACHE__ = { data: null, ts: 0, promise: null }
  }
  return w.__MV_AUTH_CACHE__
}

export async function getAuth(options: { force?: boolean } = {}): Promise<AuthResponse | null> {
  const cache = getCache()
  const now = Date.now()
  const ttl = cache.data?.authenticated ? CACHE_TTL_MS : UNAUTH_TTL_MS

  if (!options.force && cache.data && now - cache.ts < ttl) {
    return cache.data
  }

  if (!options.force && cache.promise) {
    return cache.promise
  }

  const promise = fetch('/api/auth/me', { credentials: 'include' })
    .then(async res => {
      if (res.status === 401) {
        return { authenticated: false } as AuthResponse
      }
      if (!res.ok) return null
      const payload = await res.json().catch(() => null)
      return payload && payload.authenticated !== undefined
        ? (payload as AuthResponse)
        : null
    })
    .catch(() => null)
    .finally(() => {
      const fresh = getCache()
      fresh.promise = null
    })

  cache.promise = promise
  const data = await promise
  cache.data = data
  cache.ts = Date.now()
  return data
}

export function clearAuthCache() {
  const cache = getCache()
  cache.data = null
  cache.ts = 0
  cache.promise = null
}
