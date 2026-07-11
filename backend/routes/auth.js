module.exports = async function authRoutes(fastify, opts) {
  const {
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
  } = opts

  const SESSION_STALE_MS = 15 * 60 * 1000
  const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

  const trackInternalIp = (req) => {
    try {
      const forwarded = req?.headers?.['x-forwarded-for']
      const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req?.ip) || null
      if (ip) {
        pool.query(`INSERT INTO known_internal_ips (ip) VALUES ($1) ON CONFLICT (ip) DO UPDATE SET last_seen_at = NOW()`, [ip]).catch(()=>{})
      }
    } catch {}
  }

  const cleanupStaleSessions = async () => {
    try {
      const intervalMinutes = Math.floor(SESSION_STALE_MS / 60000)
      const staleRes = await pool.query(
        `
        UPDATE user_sessions
        SET last_seen_at = COALESCE(last_seen_at, login_at),
            logout_at = COALESCE(last_seen_at, login_at),
            duration_seconds = EXTRACT(EPOCH FROM (COALESCE(last_seen_at, login_at) - login_at))::int
        WHERE logout_at IS NULL
          AND COALESCE(last_seen_at, login_at) <= NOW() - ($1::text || ' minutes')::interval
        RETURNING id, user_id, duration_seconds, device_type, client_kind, platform, client_name, client_version
        `,
        [intervalMinutes]
      )
      for (const row of staleRes.rows || []) {
        await logLeadActivity(
          null,
          'session_ended',
          {
            log_type: 'audit',
            session_id: row.id,
            duration_seconds: row.duration_seconds,
            end_reason: 'inactive',
            client_kind: row.client_kind,
            device_type: row.device_type,
            platform: row.platform,
            client_name: row.client_name,
            client_version: row.client_version,
          },
          row.user_id
        )
      }
    } catch (err) {
      // no-op to avoid crashing auth routes
    }
  }

  setInterval(cleanupStaleSessions, SESSION_CLEANUP_INTERVAL_MS).unref()

  fastify.post('/auth/login', async (req, reply) => {
    const { email, password } = req.body || {}
    const loginName = String(email || '').trim().toLowerCase()

    if (!loginName || !password) {
      return reply.code(400).send({ error: 'Email/Phone and password are required' })
    }

    const compactPhone = loginName.replace(/[\s\-().]/g, '')
    const isPhone = /^\d{10}$/.test(compactPhone) || /^\+91\d{10}$/.test(compactPhone)

    let query = 'SELECT id, email, phone, password_hash, role, is_active, is_login_enabled, force_password_reset FROM users WHERE email=$1'
    let queryParam = loginName

    if (isPhone) {
      query = 'SELECT id, email, phone, password_hash, role, is_active, is_login_enabled, force_password_reset FROM users WHERE phone=$1'
      // If the user entered a 10 digit number but the DB has +91, this might fail unless cleaned.
      // Easiest approach given the constraints: strictly match what is passed in, or rely on the frontend passing the right format.
      // But let's check both just in case, or let the user ensure they type it as stored.
      queryParam = compactPhone.startsWith('+91') ? compactPhone : `+91${compactPhone}`
      // Fallback: If we search for just the 10 digit or +91 format
      query = 'SELECT id, email, phone, password_hash, role, is_active, is_login_enabled, force_password_reset FROM users WHERE phone=$1 OR phone=$2'
    }

    const r = await pool.query(
      query,
      isPhone ? [compactPhone, queryParam] : [queryParam]
    )
    if (!r.rows.length) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    const user = r.rows[0]
    if (user.is_active === false) {
      return reply.code(403).send({ error: 'User disabled' })
    }
    if (user.is_login_enabled === false) {
      return reply.code(403).send({ error: 'Login disabled for this account' })
    }
    if (!verifyPassword(String(password), user.password_hash)) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    const clientInfo = getClientInfo(req)
    const sessionRes = await pool.query(
      `INSERT INTO user_sessions (user_id, login_at, last_seen_at, device_type, user_agent, client_kind, platform, client_name, client_version)
       VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6, $7)
       RETURNING id, login_at, last_seen_at, device_type, client_kind, platform, client_name, client_version`,
      [
        user.id,
        clientInfo.device_type,
        clientInfo.user_agent,
        clientInfo.client_kind,
        clientInfo.platform,
        clientInfo.client_name,
        clientInfo.client_version,
      ]
    )
    const sessionRow = sessionRes.rows[0] || null
    const sessionId = sessionRow?.id || null

    const rolesRes = await pool.query(
      `SELECT r.key
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1
       ORDER BY r.key ASC`,
      [user.id]
    )
    const roles = rolesRes.rows.map(row => row.key)

    const token = signToken({
      sub: user.id,
      email: user.email || user.phone,
      role: user.role,
      roles,
      sid: sessionId,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    })

    setAuthCookie(reply, token)
    await logLeadActivity(
      null,
      'audit_login',
      {
        log_type: 'audit',
        client_kind: clientInfo.client_kind,
        device_type: clientInfo.device_type,
        platform: clientInfo.platform,
        client_name: clientInfo.client_name,
        client_version: clientInfo.client_version,
      },
      user.id
    )
    await logLeadActivity(
      null,
      'session_started',
      {
        log_type: 'audit',
        start_reason: 'login',
        session_id: sessionId,
        client_kind: clientInfo.client_kind,
        device_type: clientInfo.device_type,
        platform: clientInfo.platform,
        client_name: clientInfo.client_name,
        client_version: clientInfo.client_version,
      },
      user.id
    )

    trackInternalIp(req)

    return {
      success: true,
      role: user.role,
      roles,
      email: user.email || user.phone,
      token,
      force_password_reset: user.force_password_reset === true,
    }
  })

  fastify.post('/auth/logout', async (req, reply) => {
    const auth = getAuthFromRequest(req)
    clearAuthCookie(reply)
    if (auth?.sub) {
      try {
        await logLeadActivity(null, 'audit_logout', { log_type: 'audit' }, auth.sub)
        const sessionId = auth?.sid
        if (sessionId) {
          const updated = await pool.query(
            `
            UPDATE user_sessions
            SET logout_at=NOW(),
                last_seen_at=COALESCE(last_seen_at, NOW()),
                duration_seconds=EXTRACT(EPOCH FROM (NOW() - login_at))::int
            WHERE id=$1 AND user_id=$2 AND logout_at IS NULL
            RETURNING id, login_at, logout_at, duration_seconds, device_type, client_kind, platform, client_name, client_version
            `,
            [sessionId, auth.sub]
          )
          const sessionRow = updated.rows[0]
          if (sessionRow) {
            await logLeadActivity(
              null,
              'session_ended',
              {
                log_type: 'audit',
                session_id: sessionRow.id,
                duration_seconds: sessionRow.duration_seconds,
                end_reason: 'logout',
                client_kind: sessionRow.client_kind,
                device_type: sessionRow.device_type,
                platform: sessionRow.platform,
                client_name: sessionRow.client_name,
                client_version: sessionRow.client_version,
              },
              auth.sub
            )
          }
        } else {
          const updated = await pool.query(
            `
            WITH target AS (
              SELECT id FROM user_sessions
              WHERE user_id=$1 AND logout_at IS NULL
              ORDER BY login_at DESC
              LIMIT 1
            )
            UPDATE user_sessions
            SET logout_at=NOW(),
                last_seen_at=COALESCE(last_seen_at, NOW()),
                duration_seconds=EXTRACT(EPOCH FROM (NOW() - login_at))::int
            WHERE id IN (SELECT id FROM target)
            RETURNING id, login_at, logout_at, duration_seconds, device_type, client_kind, platform, client_name, client_version
            `,
            [auth.sub]
          )
          const sessionRow = updated.rows[0]
          if (sessionRow) {
            await logLeadActivity(
              null,
              'session_ended',
              {
                log_type: 'audit',
                session_id: sessionRow.id,
                duration_seconds: sessionRow.duration_seconds,
                end_reason: 'logout',
                client_kind: sessionRow.client_kind,
                device_type: sessionRow.device_type,
                platform: sessionRow.platform,
                client_name: sessionRow.client_name,
                client_version: sessionRow.client_version,
              },
              auth.sub
            )
          }
        }
      } catch (err) {
        console.warn('Logout session update failed:', err?.message || err)
      }
    }
    return { success: true }
  })

  fastify.get('/auth/me', async (req, reply) => {
    const auth = requireAuth(req, reply)
    if (!auth) return
    trackInternalIp(req)
    const r = await pool.query(
      'SELECT id, email, role, name, nickname, profile_photo, job_title, force_password_reset, is_active, signature_image, signature_image_dark FROM users WHERE id=$1',
      [auth.sub]
    )
    const user = r.rows[0] || {
      id: auth.sub,
      email: auth.email,
      role: auth.role,
      name: null,
      nickname: null,
      profile_photo: null,
      job_title: null,
      force_password_reset: false,
      is_active: true,
    }
    const rolesRes = await pool.query(
      `SELECT r.key
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1
       ORDER BY r.key ASC`,
      [user.id]
    )
    const roles = rolesRes.rows.map(row => row.key)
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      authenticated: true,
      is_impersonated: !!auth.impersonator,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        roles,
        name: user.name,
        nickname: user.nickname,
        job_title: user.job_title,
        has_photo: !!user.profile_photo,
        has_signature: !!user.signature_image,
        force_password_reset: user.force_password_reset === true,
      },
    }
  })

  fastify.post('/auth/heartbeat', async (req, reply) => {
    const auth = requireAuth(req, reply)
    if (!auth) return
    trackInternalIp(req)

    const event = String(req.body?.event || 'ping').toLowerCase()
    const clientInfo = getClientInfo(req)
    const now = new Date()
    const staleMs = SESSION_STALE_MS

    const currentRes = await pool.query(
      `SELECT *
       FROM user_sessions
       WHERE user_id=$1 AND logout_at IS NULL
       ORDER BY login_at DESC
       LIMIT 1`,
      [auth.sub]
    )
    const current = currentRes.rows[0] || null

    const endSession = async (sessionRow, reason = 'inactive') => {
      const endAt = sessionRow?.last_seen_at
        ? new Date(sessionRow.last_seen_at)
        : sessionRow?.login_at
          ? new Date(sessionRow.login_at)
          : now
      const updated = await pool.query(
        `
        UPDATE user_sessions
        SET logout_at=$1,
            last_seen_at=COALESCE(last_seen_at, $1),
            duration_seconds=EXTRACT(EPOCH FROM ($1 - login_at))::int
        WHERE id=$2
        RETURNING id, duration_seconds, device_type, client_kind, platform, client_name, client_version
        `,
        [endAt, sessionRow.id]
      )
      const finalRow = updated.rows[0]
      if (finalRow) {
        await logLeadActivity(
          null,
          'session_ended',
          {
            log_type: 'audit',
            session_id: finalRow.id,
            duration_seconds: finalRow.duration_seconds,
            end_reason: reason,
            client_kind: finalRow.client_kind,
            device_type: finalRow.device_type,
            platform: finalRow.platform,
            client_name: finalRow.client_name,
            client_version: finalRow.client_version,
          },
          auth.sub
        )
      }
    }

    if (event === 'close') {
      return { ok: true }
    }

    if (current) {
      const lastSeen = current.last_seen_at ? new Date(current.last_seen_at) : null
      const baseTime = lastSeen || (current.login_at ? new Date(current.login_at) : null)
      const isStale = baseTime ? now.getTime() - baseTime.getTime() > staleMs : false
      if (!isStale) {
        await pool.query('UPDATE user_sessions SET last_seen_at=NOW() WHERE id=$1', [current.id])
        return { ok: true }
      }
      await endSession(current, 'inactive')
    }

    if (event !== 'open') {
      return { ok: true }
    }

    const created = await pool.query(
      `INSERT INTO user_sessions (user_id, login_at, last_seen_at, device_type, user_agent, client_kind, platform, client_name, client_version)
       VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        auth.sub,
        clientInfo.device_type,
        clientInfo.user_agent,
        clientInfo.client_kind,
        clientInfo.platform,
        clientInfo.client_name,
        clientInfo.client_version,
      ]
    )

    const newSessionId = created.rows[0]?.id || null
    await logLeadActivity(
      null,
      'session_started',
      {
        log_type: 'audit',
        start_reason: event === 'open' ? 'app_visit' : event,
        session_id: newSessionId,
        client_kind: clientInfo.client_kind,
        device_type: clientInfo.device_type,
        platform: clientInfo.platform,
        client_name: clientInfo.client_name,
        client_version: clientInfo.client_version,
      },
      auth.sub
    )

    return { ok: true }
  })

  fastify.post('/auth/nickname', async (req, reply) => {
    const auth = getAuthFromRequest(req)
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' })

    const raw = req.body?.nickname
    if (raw && String(raw).trim().length > 50) {
      return reply.code(400).send({ error: 'Nickname must be 50 characters or less' })
    }
    const normalized = normalizeNickname(raw)

    await pool.query('UPDATE users SET nickname=$1 WHERE id=$2', [normalized, auth.sub])
    await logLeadActivity(null, 'audit_profile_update', { log_type: 'audit', fields: ['nickname'] }, auth.sub)
    return { success: true, nickname: normalized }
  })

  fastify.get('/auth/profile-photo', async (req, reply) => {
    const auth = getAuthFromRequest(req)
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' })

    const r = await pool.query('SELECT profile_photo FROM users WHERE id=$1', [auth.sub])
    const dataUrl = r.rows[0]?.profile_photo
    if (!dataUrl) return reply.code(404).send({ error: 'No photo' })

    const parsed = parseDataUrl(dataUrl)
    if (!parsed) return reply.code(400).send({ error: 'Invalid photo data' })

    const buffer = Buffer.from(parsed.base64, 'base64')
    reply.header('Content-Type', parsed.mime)
    return buffer
  })

  fastify.post('/auth/profile-photo', async (req, reply) => {
    const auth = getAuthFromRequest(req)
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' })
    const { image_data } = req.body || {}
    const parsed = parseDataUrl(image_data)
    if (!parsed) {
      return reply.code(400).send({ error: 'Invalid image format' })
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(parsed.mime)) {
      return reply.code(400).send({ error: 'Only JPG, PNG, or WEBP allowed' })
    }
    const bytes = Math.floor((parsed.base64.length * 3) / 4)
    if (bytes > 2 * 1024 * 1024) {
      return reply.code(400).send({ error: 'Image must be 2MB or less' })
    }

    await pool.query('UPDATE users SET profile_photo=$1 WHERE id=$2', [image_data, auth.sub])
    await logLeadActivity(null, 'audit_profile_update', { log_type: 'audit', fields: ['profile_photo'] }, auth.sub)
    return { success: true }
  })

  fastify.get('/auth/signature', async (req, reply) => {
    const auth = getAuthFromRequest(req)
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' })

    const r = await pool.query('SELECT signature_image, signature_image_dark FROM users WHERE id=$1', [auth.sub])
    if (!r.rows.length || !r.rows[0].signature_image) {
      return reply.code(404).send({ error: 'No signature' })
    }
    return { 
      signature_image: r.rows[0].signature_image,
      signature_image_dark: r.rows[0].signature_image_dark 
    }
  })

  fastify.post('/auth/signature', async (req, reply) => {
    const auth = getAuthFromRequest(req)
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' })
    
    const { signature_image, signature_image_dark } = req.body || {}
    if (!signature_image) {
      return reply.code(400).send({ error: 'Signature image is required' })
    }

    await pool.query('UPDATE users SET signature_image=$1, signature_image_dark=$2 WHERE id=$3', [signature_image, signature_image_dark || null, auth.sub])
    await logLeadActivity(null, 'audit_profile_update', { log_type: 'audit', fields: ['signature'] }, auth.sub)
    return { success: true }
  })

  fastify.post('/auth/change-password', async (req, reply) => {
    const auth = getAuthFromRequest(req)
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' })
    const { current_password, new_password } = req.body || {}
    if (!current_password || !new_password) {
      return reply.code(400).send({ error: 'Current and new password are required' })
    }

    const r = await pool.query(
      'SELECT password_hash FROM users WHERE id=$1',
      [auth.sub]
    )
    if (!r.rows.length) {
      return reply.code(404).send({ error: 'User not found' })
    }
    const ok = verifyPassword(String(current_password), r.rows[0].password_hash)
    if (!ok) {
      return reply.code(401).send({ error: 'Current password is incorrect' })
    }

    const nextHash = hashPassword(String(new_password))
    await pool.query(
      'UPDATE users SET password_hash=$1, force_password_reset=false, updated_at=NOW() WHERE id=$2',
      [nextHash, auth.sub]
    )
    await logLeadActivity(null, 'audit_password_change', { log_type: 'audit' }, auth.sub)
    return { success: true }
  })

  fastify.post('/auth/impersonate', async (req, reply) => {
    const auth = getAuthFromRequest(req)
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' })
    const roles = Array.isArray(auth.roles) ? auth.roles : auth.role ? [auth.role] : []
    if (!roles.includes('admin')) {
      return reply.code(403).send({ error: 'Admin only' })
    }

    const { userId } = req.body || {}
    if (!userId) return reply.code(400).send({ error: 'User ID is required' })

    const userRes = await pool.query(
      'SELECT id, email, role, name FROM users WHERE id=$1 AND is_active=true',
      [Number(userId)]
    )
    if (!userRes.rows.length) {
      return reply.code(404).send({ error: 'Target user not found or inactive' })
    }
    const targetUser = userRes.rows[0]

    const targetRolesRes = await pool.query(
      `SELECT r.key
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1
       ORDER BY r.key ASC`,
      [targetUser.id]
    )
    const targetRoles = targetRolesRes.rows.map(row => row.key)

    const token = signToken({
      sub: targetUser.id,
      email: targetUser.email,
      role: targetUser.role,
      roles: targetRoles,
      impersonator: auth.sub,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
    })

    const currentCookieName = opts.AUTH_COOKIE || 'mv_auth'
    const currentToken =
      (req.cookies && req.cookies[currentCookieName]) ||
      (() => {
        const list = {}
        const cookieHeader = req.headers.cookie
        if (cookieHeader) {
          cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.split('=')
            list[parts.shift().trim()] = decodeURI(parts.join('='))
          })
        }
        return list[currentCookieName] || null
      })()

    const common = {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    }
    reply.setCookie('mv_admin_auth', currentToken, common)
    setAuthCookie(reply, token)

    return { success: true }
  })

  fastify.post('/auth/impersonate/stop', async (req, reply) => {
    const adminToken =
      (req.cookies && req.cookies['mv_admin_auth']) ||
      (() => {
        const list = {}
        const cookieHeader = req.headers.cookie
        if (cookieHeader) {
          cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.split('=')
            list[parts.shift().trim()] = decodeURI(parts.join('='))
          })
        }
        return list['mv_admin_auth'] || null
      })()

    const common = {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    }

    if (adminToken) {
      setAuthCookie(reply, adminToken)
      reply.setCookie('mv_admin_auth', '', { ...common, maxAge: 0 })
    } else {
      clearAuthCookie(reply)
    }

    return { success: true }
  })
}
