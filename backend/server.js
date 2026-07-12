
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


/* ===================== CORS ===================== */

const PROD_ORIGIN = process.env.APP_ORIGIN
const DEV_ORIGINS = (process.env.DEV_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
const ALLOWED_ORIGINS = [PROD_ORIGIN, ...DEV_ORIGINS].filter(Boolean)

fastify.register(cors, {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (!ALLOWED_ORIGINS.length) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    return callback(new Error('Origin not allowed'), false)
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  credentials: true,
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

fastify.addHook('onRequest', (req, reply, done) => {
  const url = req.raw?.url || req.url || ''
  if (req.method === 'OPTIONS') return done()
  const path = url.split('?')[0]
  if (PUBLIC_API_PATHS.has(path)) return done()
  if (PUBLIC_WEBSITE_PREFIXES.some(p => path.startsWith(p))) return done()
  // Proposal endpoints are public — accessed by unauthenticated clients
  if (path.startsWith('/api/proposals/') || path.startsWith('/proposals/')) return done()
  // Proforma invoice — public client-facing payment schedule
  if (path.startsWith('/api/proforma/') || path.startsWith('/proforma/')) return done()
  // Client portal — public client-facing project timeline
  if (path.startsWith('/api/client-portal/') || path.startsWith('/client-portal/')) return done()
  // Guest gallery portal — public client-facing wedding photo matching
  if (path.startsWith('/api/gallery/public/') || path.startsWith('/gallery/public/')) return done()
  // Circle portal public auth endpoints
  if (path === '/api/gallery/family/auth' || path === '/api/gallery/family/auth-from-event') return done()
  // Public catalog endpoints for proposal viewers
  if (path === '/api/catalog/addons/public' || path === '/catalog/addons/public') return done()
  if (path.endsWith('/events') && (path.startsWith('/api/proposals/') || path.startsWith('/proposals/'))) return done()
  if (path.startsWith('/api/photos/file/') || path.startsWith('/photos/file/')) return done()
  if (path.startsWith('/api/videos/file/') || path.startsWith('/videos/file/')) return done()
  const auth = getAuthFromRequest(req)
  if (auth) req.auth = auth
  if (!auth) {
    reply.code(401).send({ error: 'Not authenticated' })
    return
  }
  done()
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
// Removed /* ===================== PUBLIC WEBSITE ===================== */

// Removed apiRoutes registration
// Removed apiRoutes registration

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
