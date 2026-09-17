
require('dotenv').config()
const fastify = require('fastify')({ logger: true, bodyLimit: 524288000 })
const cors = require('@fastify/cors')
const cookie = require('@fastify/cookie')
const jwt = require('@fastify/jwt')
const multipart = require('@fastify/multipart')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const authRoutes = require('./routes/auth')

/* ===================== BOOTSTRAP DIRS ===================== */
// Ensure all required upload directories exist before handling any requests.
// mkdirSync with { recursive: true } is safe to call even if the dir already exists.
;[
  path.join(__dirname, 'uploads', 'photos', 'selfies'),
  path.join(__dirname, 'uploads', 'photos'),
  path.join(__dirname, 'db'),
].forEach(dir => {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {
    console.error(`[bootstrap] Failed to create dir ${dir}:`, e.message)
  }
})

/* ===================== DB ===================== */
const { pool } = require('./db.js')


/* ===================== CORS & SECURITY HEADERS ===================== */

const PROD_ORIGIN = process.env.APP_ORIGIN
const DEV_ORIGINS = (process.env.DEV_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

const DEFAULT_ORIGINS = [
  'https://mycircle.mistyvisuals.com',
  'https://www.mistyvisuals.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8081',
  'http://127.0.0.1:3000',
]

const ALLOWED_ORIGINS = Array.from(new Set([
  PROD_ORIGIN,
  ...DEV_ORIGINS,
  ...DEFAULT_ORIGINS
])).filter(Boolean)

fastify.register(cors, {
  origin: (origin, callback) => {
    // Allow non-browser clients (Mobile apps, Postman, Electron desktop uploader) with no Origin header
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    return callback(null, false)
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-preview-token'],
  credentials: true,
})

// Essential Security Headers
fastify.addHook('onSend', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'SAMEORIGIN')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Cross-Origin-Resource-Policy', 'cross-origin')
})

const AUTH_COOKIE = 'mv_auth'
const AUTH_SECRET = process.env.AUTH_SECRET
if (!AUTH_SECRET) {
  throw new Error('AUTH_SECRET is required.')
}

fastify.register(cookie, { hook: 'onRequest' })
fastify.register(jwt, { secret: AUTH_SECRET })

fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
  try {
    req.rawBody = body
    var json = JSON.parse(body)
    done(null, json)
  } catch (err) {
    err.statusCode = 400
    done(err, undefined)
  }
})
fastify.register(multipart, { limits: { fileSize: 524288000 } }) // 500MB multipart limit



/* ===================== CONSTANTS ===================== */
const constants = require('./config/constants.js')
const {
  LEAD_STATUSES, COVERAGE_SCOPES, FOLLOWUP_TYPES, HEAT_VALUES, UPLOADS_DIR, PHOTO_UPLOAD_DIR
} = constants;

/* ===================== HELPERS ===================== */
const helpers = require('./utils/helpers.js')({
  pool, fs, path, crypto, jwt, fastify, AUTH_SECRET, AUTH_COOKIE, ...constants
})
const {
  setAuthCookie, normalizeYMD, getUserDisplayName, canonicalizeInstagram, startOfDay, ALLOWED_COMPOUND_TLDS, listFyLabelsBetween, recomputeLeadMetrics, normalizeEmailInput, addDaysToYMD, recomputeUserMetrics, resolveUserDisplayName, COMMON_EMAIL_DOMAINS, hasEventsForAllCities, signToken, EMAIL_TYPO_MAP, logAdminAudit, hasAnyEvent, sanitizeTags, getCurrentFyLabel, getOrCreateCity, requireAuth, parseDataUrl, normalizeLeadRow, ensureDirectory, ALLOWED_EMAIL_TLDS, hasAllEventTimes, canonicalizeEmail, normalizeInstagramUrl, normalizeLeadRows, isProtectedAdminUser, parseCookies, getFirstName, getAuthFromRequest, normalizePhone, hasEventInPrimaryCity, isValidInstagramUsername, createNotification, formatName, normalizeNickname, getDateRange, requireVendor, dateToYMD, validateEmail, assignReferenceCode, formatRefDate, PROTECTED_ADMIN_EMAIL, getAvailableFyLabels, yesNoToBool, verifyPassword, getFyLabelFromDate, logLeadActivity, getFyRange, boolToYesNo, getImageContentType, getRoundRobinSalesUserId, parseFyLabel, hashPassword, hasPrimaryCity, verifyToken, requireAdmin, normalizeDateValue, addDaysYMD, clearAuthCookie, fetchProfitProjectRows, toISTDateString, getNextLeadNumber, canonicalizePhone
} = helpers;

/* ===================== PUSH-ENHANCED NOTIFICATION ===================== */
// Wraps createNotification to also fire a native push notification.
// Uses late-binding for sendPushToUser/sendPushToRole so they work after
// the push module is imported above.
async function createNotificationWithPush(notifArgs, client) {
  await createNotification(notifArgs, client)
  // Only push for action-required notifications — not for proposal views, status updates etc.
  if (!notifArgs.isActionRequired) return
  try {
    const pushPayload = {
      title: notifArgs.title,
      body: notifArgs.message,
      url: notifArgs.linkUrl || '/',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      tag: `mv-action-${notifArgs.linkUrl || 'general'}`,
    }
    if (notifArgs.userId) {
      await sendPushToUser(pool, notifArgs.userId, pushPayload)
    } else if (notifArgs.roleTarget) {
      await sendPushToRole(pool, notifArgs.roleTarget, pushPayload)
    }
  } catch (pushErr) {
    console.warn('[push] Failed to send push notification:', pushErr?.message || pushErr)
  }
}

/* ===================== BALANCE RECALCULATION ===================== */
let balanceRefreshRunning = false
async function recalculateAccountBalances() {
  if (balanceRefreshRunning) return
  balanceRefreshRunning = true
  try {
    await pool.query(
      `
      WITH sums AS (
        SELECT money_source_id,
               SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) as balance
        FROM finance_transactions
        WHERE is_deleted = false
        GROUP BY money_source_id
      ),
      rows AS (
        SELECT ms.id as money_source_id, COALESCE(s.balance, 0) as balance
        FROM money_sources ms
        LEFT JOIN sums s ON s.money_source_id = ms.id
      )
      INSERT INTO finance_account_balances (money_source_id, balance, last_calculated_at)
      SELECT money_source_id, balance, NOW()
      FROM rows
      ON CONFLICT (money_source_id)
      DO UPDATE SET balance = EXCLUDED.balance, last_calculated_at = EXCLUDED.last_calculated_at
      `
    )
  } catch (err) {
    if (err?.code !== '42P01') {
      console.warn('Balance refresh failed:', err?.message || err)
    }
  } finally {
    balanceRefreshRunning = false
  }
}

// Removed metricsJob definition

/* ===================== API AUTH GUARD ===================== */
const PUBLIC_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
  '/api/version',
  '/api/app-config/version',
  '/api/app-config/banner.svg',
  '/api/app-config/banner.jpg',
  '/api/app-config/banner.png',
  '/api/webhooks/meta',
  '/auth/login',
  '/auth/logout',
  '/health',
  '/version',
  '/webhooks/meta',
])

// Public website paths (no auth needed)
const PUBLIC_WEBSITE_PREFIXES = [
  '/api/website/home',
  '/api/website/stories',
  '/api/website/films',
  '/api/website/sections',
  '/media/website/',
]

const { createRateLimiter, getClientIp } = require('./utils/rateLimiter');

const globalPublicRateLimiter = createRateLimiter({
  name: 'global_public',
  timeWindowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => {
    const ip = getClientIp(req);
    const match = (req.url || '').match(/\/events\/([^\/\?]+)/);
    const slug = match ? match[1].toLowerCase() : 'global';
    let tokenSnippet = '';
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      tokenSnippet = req.headers.authorization.split(' ')[1].substring(0, 20);
    }
    return `${ip}:${slug}${tokenSnippet ? ':' + tokenSnippet : ''}`;
  },
  errorMessage: 'Server busy. Please slow down your requests.'
});

// Map to track verified modern app (1.2.0+) clients by device signature (IP + User-Agent) and tokens
const verifiedModernClients = new Map();

function getClientSignature(req) {
  const ip = req.ip || req.raw?.socket?.remoteAddress || req.socket?.remoteAddress || 'unknown-ip';
  const ua = (req.headers['user-agent'] || 'unknown-ua').toLowerCase();
  return `${ip}::${ua}`;
}

function markClientAsModern(req) {
  const sig = getClientSignature(req);
  verifiedModernClients.set(sig, Date.now());
  const token = req.headers.authorization || req.headers['x-guest-token'];
  if (token) verifiedModernClients.set(token, Date.now());
}

function isClientVerifiedModern(req) {
  const sig = getClientSignature(req);
  if (verifiedModernClients.has(sig)) return true;
  const token = req.headers.authorization || req.headers['x-guest-token'];
  if (token && verifiedModernClients.has(token)) return true;
  return false;
}

fastify.addHook('onRequest', async (req, reply) => {
  const url = req.raw?.url || req.url || ''
  if (req.method === 'OPTIONS') return
  const path = url.split('?')[0]

  if (req.headers['x-app-version']) {
    markClientAsModern(req);
  }

  // Intercept mobile app requests: ONLY verified 1.2.0+ users see actual photos.
  // All other unverified mobile app clients see the upgrade photo banner.
  if (path.startsWith('/api/gallery/public/') || path.startsWith('/api/gallery/family')) {
    const appVer = req.headers['x-app-version'];
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    const isMobileApp = Boolean(appVer) || ua.includes('okhttp') || ua.includes('cfnetwork') || ua.includes('expo') || ua.includes('mycircle') || ua.includes('darwin') || ua.includes('reactnative') || !ua.includes('mozilla');

    const isVerified120 = isClientVerifiedModern(req) || (appVer && (appVer.startsWith('1.2') || appVer.startsWith('1.3') || appVer === '1.2.0'));
    const isUnverifiedMobileClient = isMobileApp && !isVerified120;

    const isPhotoOrGalleryPath = path.includes('/photos') || path.includes('/favorites') || path.includes('/matched-photos');

    if (isUnverifiedMobileClient && isPhotoOrGalleryPath) {
      const bannerUrl = 'https://mycircle.mistyvisuals.com/api/app-config/banner.jpg?v=v5';
      const bannerItem = {
        id: 999999,
        r2Url: bannerUrl,
        thumbnailUrl: bannerUrl,
        previewUrl: bannerUrl,
        aspectRatio: 1.5,
        width: 1200,
        height: 800,
        caption: "🚀 TIME FOR APP UPGRADE! We've added fresh new features to the app! Update to the latest version on the App Store or Google Play Store to view your full photo gallery & cinema reels.",
        title: "🚀 TIME FOR APP UPGRADE",
        category: 'ALL',
        tabName: 'ALL',
        uploadedAt: new Date().toISOString()
      };
      return reply.code(200).send({
        photos: [bannerItem],
        matchedPhotos: [bannerItem],
        favorites: [bannerItem],
        total: 1,
        hasMore: false
      });
    }
  }

  // Apply high-capacity global rate limit to public gallery endpoints
  if (path.startsWith('/api/gallery/public/') || path.startsWith('/gallery/public/')) {
    await globalPublicRateLimiter(req, reply);
    if (reply.sent) return;
    return;
  }

  if (PUBLIC_API_PATHS.has(path)) return
  if (PUBLIC_WEBSITE_PREFIXES.some(p => path.startsWith(p))) return
  // Proposal endpoints are public — accessed by unauthenticated clients
  if (path.startsWith('/api/proposals/') || path.startsWith('/proposals/')) return
  // Proforma invoice — public client-facing payment schedule
  if (path.startsWith('/api/proforma/') || path.startsWith('/proforma/')) return
  // Client portal — public client-facing project timeline
  if (path.startsWith('/api/client-portal/') || path.startsWith('/client-portal/')) return
  // Circle portal public auth endpoints
  if (path === '/api/gallery/family/auth' || path === '/api/gallery/family/auth-from-event') return
  // Public catalog endpoints for proposal viewers
  if (path === '/api/catalog/addons/public' || path === '/catalog/addons/public') return
  if (path.endsWith('/events') && (path.startsWith('/api/proposals/') || path.startsWith('/proposals/'))) return
  if (path.startsWith('/api/photos/file/') || path.startsWith('/photos/file/')) return
  if (path.startsWith('/api/videos/file/') || path.startsWith('/videos/file/')) return
  if (path === '/api/gallery/resize') return
  const auth = getAuthFromRequest(req)
  if (auth) req.auth = auth
  if (!auth) {
    reply.code(401).send({ error: 'Not authenticated' })
    return
  }
})

fastify.addHook('preHandler', async (req, reply) => {
  const url = req.raw?.url || req.url || ''
  const path = url.split('?')[0]
  if (req.params && req.params.id && (path.startsWith('/api/leads/') || path.startsWith('/leads/'))) {
    const auth = req.auth || getAuthFromRequest(req)
    if (!auth) {
      reply.code(401).send({ error: 'Not authenticated' })
      return
    }
    const roles = Array.isArray(auth.roles) ? auth.roles : auth.role ? [auth.role] : []
    const isAdmin = roles.includes('admin')
    if (isAdmin) return

    const leadId = req.params.id
    if (Number.isNaN(Number(leadId))) return

    const leadRes = await pool.query(
      'SELECT assigned_user_id FROM leads WHERE id = $1',
      [Number(leadId)]
    )
    if (!leadRes.rows.length) {
      reply.code(404).send({ error: 'Lead not found' })
      return
    }
    const assignedUserId = leadRes.rows[0].assigned_user_id
    if (assignedUserId !== auth.sub) {
      reply.code(403).send({ error: 'Access denied: You are not assigned to this lead' })
      return
    }
  }
})


function classifyDeviceType(userAgent) {
  const ua = String(userAgent || '').toLowerCase()
  if (!ua) return 'desktop'
  if (ua.includes('ipad') || ua.includes('tablet')) return 'tablet'
  if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) {
    return 'mobile'
  }
  return 'desktop'
}

function detectPlatform(userAgent) {
  const ua = String(userAgent || '').toLowerCase()
  if (!ua) return 'unknown'
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios'
  if (ua.includes('android')) return 'android'
  if (ua.includes('windows')) return 'windows'
  if (ua.includes('mac os x') || ua.includes('macintosh')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  return 'unknown'
}

function detectBrowser(userAgent) {
  const ua = String(userAgent || '')
  const lower = ua.toLowerCase()
  if (lower.includes('edg/')) {
    const match = /edg\/([\d.]+)/i.exec(ua)
    return { name: 'Edge', version: match?.[1] || null }
  }
  if (lower.includes('chrome/')) {
    const match = /chrome\/([\d.]+)/i.exec(ua)
    return { name: 'Chrome', version: match?.[1] || null }
  }
  if (lower.includes('firefox/')) {
    const match = /firefox\/([\d.]+)/i.exec(ua)
    return { name: 'Firefox', version: match?.[1] || null }
  }
  if (lower.includes('safari/') && lower.includes('version/')) {
    const match = /version\/([\d.]+)/i.exec(ua)
    return { name: 'Safari', version: match?.[1] || null }
  }
  return { name: 'Unknown', version: null }
}

function getClientInfo(req) {
  const userAgent = String(req.headers['user-agent'] || '')
  const headerClientType = String(req.headers['x-client-type'] || '').toLowerCase()
  const headerPlatform = String(req.headers['x-client-platform'] || '').toLowerCase()
  const headerDevice = String(req.headers['x-device-type'] || '').toLowerCase()
  const headerName =
    String(req.headers['x-client-name'] || req.headers['x-app-name'] || '').trim()
  const headerVersion =
    String(req.headers['x-client-version'] || req.headers['x-app-version'] || '').trim()

  const clientKind = headerClientType === 'app' || headerName
    ? 'app'
    : 'browser'

  const deviceType =
    headerDevice === 'mobile' || headerDevice === 'tablet' || headerDevice === 'desktop'
      ? headerDevice
      : classifyDeviceType(userAgent)

  const platform =
    headerPlatform ||
    detectPlatform(userAgent)

  const browser = detectBrowser(userAgent)
  const clientName = headerName || (clientKind === 'browser' ? browser.name : null)
  const clientVersion = headerVersion || (clientKind === 'browser' ? browser.version : null)

  return {
    client_kind: clientKind,
    device_type: deviceType,
    platform,
    client_name: clientName,
    client_version: clientVersion,
    user_agent: userAgent,
  }
}

/* ===================== AUTH ===================== */

fastify.register(authRoutes, {
  prefix: '/api',
  pool,
  setAuthCookie,
  clearAuthCookie,
  verifyPassword,
  signToken,
  getAuthFromRequest,
  requireAuth,
  logLeadActivity,
  getClientInfo,
  normalizeNickname,
  parseDataUrl,
  hashPassword,
})
fastify.register(authRoutes, {
  prefix: '',
  pool,
  setAuthCookie,
  clearAuthCookie,
  verifyPassword,
  signToken,
  getAuthFromRequest,
  requireAuth,
  logLeadActivity,
  getClientInfo,
  normalizeNickname,
  parseDataUrl,
  hashPassword,
})

//   prefix: '/api',
//   pool,
//   getNextLeadNumber,
//   getRoundRobinSalesUserId,
//   logLeadActivity,
//   createNotification: createNotificationWithPush,
//   normalizePhone,
//   canonicalizePhone,
//   formatName,
// })
// 
//   prefix: '/api',
//   pool,
//   requireAdmin,
//   requireAuth,
// })

fastify.get('/api/health', async () => ({ status: 'ok' }))

fastify.get('/api/version', async () => ({
  version: '1.0.0',
  env: process.env.NODE_ENV,
}))
fastify.get('/health', async () => ({ status: 'ok' }))
fastify.get('/version', async () => ({ version: '1.0.0' }))


const apiRoutes = async function apiRoutes(api) {}



// Removed /* ===================== PHOTO LIBRARY ===================== */
// Removed /* ===================== VIDEO LIBRARY ===================== */
// Removed /* ===================== TESTIMONIALS ===================== */
/* ===================== GALLERY ===================== */
fastify.register(require('./routes/gallery'), {
    pool, requireAdmin, requireAuth
})
fastify.register(require('./routes/analytics'), {
    pool, requireAdmin, requireAuth
})
fastify.register(require('./routes/saves'), {
    pool, requireAdmin, requireAuth
})
// Removed /* ===================== PUBLIC WEBSITE ===================== */

// Removed apiRoutes registration
// Removed apiRoutes registration

/* ===================== APP VERSION CONFIG ===================== */
fastify.get('/api/app-config/version', async (req, reply) => {
  markClientAsModern(req);
  return reply.send({
    minSupportedVersion: '1.2.0',
    latestVersion: '1.2.0',
    forceUpdate: true,
    title: 'Update Required',
    message: 'A new version of Misty Visuals is available. Please update the app to continue using all features.',
    androidStoreUrl: 'https://play.google.com/store/apps/details?id=com.mistyvisuals.mycircle',
  });
});
function getBannerSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#0E0E14"/>
    <rect x="40" y="40" width="1120" height="720" rx="32" fill="#14141F" stroke="#2A2A3C" stroke-width="3"/>

    <circle cx="600" cy="180" r="70" fill="#1E1E2C" stroke="#F59E0B" stroke-width="3"/>
    <g transform="translate(600, 180)">
      <path d="M-20 -8 L0 -28 L20 -8 M0 -28 L0 16 M-24 24 L24 24" stroke="#F59E0B" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </g>

    <text x="600" y="320" font-family="'Futura', 'Montserrat', 'Arial', sans-serif" font-size="44" font-weight="900" fill="#FFFFFF" text-anchor="middle" letter-spacing="2">TIME FOR APP UPGRADE!</text>
    <text x="600" y="385" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#F59E0B" text-anchor="middle">We’ve added fresh new sparkle to the app! ✨</text>
    <text x="600" y="440" font-family="Arial, sans-serif" font-size="22" fill="#A1A1AA" text-anchor="middle">Update Misty Visuals from the store to view your full photo gallery &amp; cinema reels.</text>

    <g transform="translate(0, 520)">
      <text x="600" y="20" font-family="'Futura', 'Arial', sans-serif" font-size="16" font-weight="800" fill="#71717A" text-anchor="middle" letter-spacing="3">DOWNLOAD LATEST VERSION FROM</text>

      <g transform="translate(330, 42)">
        <rect width="250" height="74" rx="16" fill="#1E1E2A" stroke="#3F3F54" stroke-width="2"/>
        <g transform="translate(24, 17) scale(1.5)">
          <path fill="#FFFFFF" d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.64c.67-.82 1.13-1.96.99-3.1-.98.04-2.16.65-2.85 1.46-.62.72-1.16 1.88-1.01 3 .1.01 2.2.06 2.87-1.36"/>
        </g>
        <text x="80" y="30" font-family="Arial, sans-serif" font-size="12" fill="#A1A1AA">Download on the</text>
        <text x="80" y="52" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#FFFFFF">App Store</text>
      </g>

      <g transform="translate(620, 42)">
        <rect width="250" height="74" rx="16" fill="#1E1E2A" stroke="#3F3F54" stroke-width="2"/>
        <g transform="translate(24, 18) scale(1.4)">
          <path fill="#00D2FF" d="M1.22 0.08C0.7 0.32 0.35 0.8 0.35 1.45v25.1c0 0.65 0.35 1.13 0.87 1.37l0.14 0.08 14.04-14.04v-0.28L1.36 0z"/>
          <path fill="#FF3A44" d="M20.06 18.62l-4.66-4.66v-0.28l4.66-4.66 0.14 0.08 5.53 3.14c1.58 0.9 1.58 2.37 0 3.27l-5.53 3.14-0.14 0.08z"/>
          <path fill="#00E676" d="M20.2 18.93L15.4 14.13 1.36 28.17c0.52 0.55 1.37 0.62 2.33 0.08l16.51-9.32z"/>
          <path fill="#FFC107" d="M20.2 9.38L3.69 0.06C2.73-0.48 1.88-0.41 1.36 0.14L15.4 14.18l4.8-4.8z"/>
        </g>
        <text x="78" y="30" font-family="Arial, sans-serif" font-size="12" fill="#A1A1AA">GET IT ON</text>
        <text x="78" y="52" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#FFFFFF">Google Play</text>
      </g>
    </g>
  </svg>`;
}

fastify.get('/api/app-config/banner.svg', async (req, reply) => {
  reply.header('Content-Type', 'image/svg+xml');
  reply.header('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
  return reply.send(getBannerSvg());
});

fastify.get('/api/app-config/banner.jpg', async (req, reply) => {
  const sharp = require('sharp');
  const jpgBuffer = await sharp(Buffer.from(getBannerSvg())).jpeg({ quality: 95 }).toBuffer();
  reply.header('Content-Type', 'image/jpeg');
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(jpgBuffer);
});

fastify.get('/api/app-config/banner.png', async (req, reply) => {
  const sharp = require('sharp');
  const pngBuffer = await sharp(Buffer.from(getBannerSvg())).png().toBuffer();
  reply.header('Content-Type', 'image/png');
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(pngBuffer);
});

/* ===================== START ===================== */


const PORT = parseInt(process.env.PORT || '3001', 10)
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
  
  // Extend timeouts for large 500MB video uploads (10 minutes)
  fastify.server.keepAliveTimeout = 600000;
  fastify.server.headersTimeout = 610000;
  fastify.server.requestTimeout = 600000;

  console.log(`Backend running on ${address}`)

  // Pre-warm the Python face recognition daemon so the cold start
  // (Python boot + ONNX model loading) happens at startup, not on the first guest's selfie.
  const faceRecManager = require('./utils/faceRecManager')
  faceRecManager.ensureDaemon()
    .then(() => console.log('[FaceRec] Daemon pre-warmed and ready.'))
    .catch(err => console.warn('[FaceRec] Daemon pre-warm failed (will retry on first request):', err?.message || err))

  // Auto-sync past selfies to Cloudflare R2 on boot if R2 is enabled
  const { syncPastSelfiesToR2 } = require('./scripts/sync_past_selfies_to_r2');
  syncPastSelfiesToR2().catch(err => console.warn('[R2 Sync] Startup selfie sync skipped/failed:', err?.message || err));

  // Admin-only background jobs (metrics, smart notifications, Facebook leads polling)
  // are disabled on the MyCircle guest portal backend. They are handled by the main OS server.
  /*
  runMetricsJob().catch(err => {
    console.warn('Metrics job failed on startup:', err?.message || err)
  })
  
  const { runSmartNotifications } = installSmartNotifications({ pool, createNotification: createNotificationWithPush })
  runSmartNotifications().catch(err => {
    console.warn('Smart notifs job failed on startup:', err?.message || err)
  })

  setInterval(() => {
    runMetricsJob().catch(err => {
      console.warn('Metrics job failed:', err?.message || err)
    })
    runSmartNotifications().catch(err => {
      console.warn('Smart notifs job failed:', err?.message || err)
    })
  }, 24 * 60 * 60 * 1000)
  */
})

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err)
})

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
})
