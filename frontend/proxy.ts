import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const IOS_APP_STORE_URL = 'https://apps.apple.com/app/id6796633077'
const ANDROID_PLAY_STORE_BASE = 'https://play.google.com/store/apps/details?id=com.mistyvisuals.mycircle'

// Social media link preview bots & web crawlers (must NOT be redirected to App Store so rich previews work)
const CRAWLER_USER_AGENTS = [
  'bot',
  'crawler',
  'spider',
  'facebookexternalhit',
  'whatsapp',
  'telegram',
  'twitterbot',
  'slackbot',
  'linkedinbot',
  'discordbot',
  'applebot',
  'googlebot',
  'bingbot',
  'yandex',
  'duckduckbot',
]

function isCrawler(ua: string): boolean {
  const lower = ua.toLowerCase()
  return CRAWLER_USER_AGENTS.some((pattern) => lower.includes(pattern))
}

function detectMobilePlatform(ua: string): 'ios' | 'android' | null {
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return null
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 1. Bypass static assets, API routes, system files, and App Store review / compliance legal pages
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/.well-known') ||
    pathname.startsWith('/icons') ||
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname === '/refund' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname.match(/\.(png|jpe?g|gif|svg|webp|ico|css|js|map|txt|xml|json)$/i)
  ) {
    return NextResponse.next()
  }

  const userAgent = req.headers.get('user-agent') || ''

  // 2. Allow crawlers and bots to fetch OpenGraph metadata and images for link previews
  if (isCrawler(userAgent)) {
    return NextResponse.next()
  }

  // 3. Detect mobile platform
  const platform = detectMobilePlatform(userAgent)

  // Desktop -> continue to website normally
  if (!platform) {
    return NextResponse.next()
  }

  // 4. Extract slug & code if present (e.g. /<slug>/gallery or /<slug>)
  const pathParts = pathname.split('/').filter(Boolean)
  let slug: string | null = null
  const galleryIdx = pathParts.indexOf('gallery')
  const reservedWords = ['terms', 'privacy', 'refund', 'contact', 'auth', 'join', 'celebration', 'event']

  if (galleryIdx > 0) {
    slug = pathParts[galleryIdx - 1]
  } else if (pathParts.length > 0 && !reservedWords.includes(pathParts[0].toLowerCase())) {
    slug = pathParts[0]
  }

  const searchParams = req.nextUrl.searchParams
  const code = searchParams.get('code') || searchParams.get('passcode') || null

  // 5. Fire-and-forget record deferred invite to backend if slug is present
  if (slug) {
    const backendUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001'
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || ''
    try {
      fetch(`${backendUrl}/api/gallery/public/record-invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': clientIp,
          'user-agent': userAgent,
        },
        body: JSON.stringify({ slug, code }),
      }).catch(() => {})
    } catch (_) {}
  }

  // 6. Redirect mobile users to App Store or Play Store
  if (platform === 'ios') {
    return NextResponse.redirect(IOS_APP_STORE_URL, { status: 307 })
  }

  if (platform === 'android') {
    let playStoreUrl = ANDROID_PLAY_STORE_BASE
    if (slug) {
      const referrerPayload = `slug%3D${encodeURIComponent(slug)}${code ? `%26code%3D${encodeURIComponent(code)}` : ''}`
      playStoreUrl = `${ANDROID_PLAY_STORE_BASE}&referrer=${referrerPayload}`
    }
    return NextResponse.redirect(playStoreUrl, { status: 307 })
  }

  return NextResponse.next()
}

export default proxy

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
