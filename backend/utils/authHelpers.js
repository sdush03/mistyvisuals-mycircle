module.exports = function installAuthHelpers(opts) {
  const { crypto, fastify, AUTH_COOKIE } = opts;

  const PROTECTED_ADMIN_EMAIL = String(process.env.PROTECTED_ADMIN_EMAIL || 'dushyant@mistyvisuals.com')
    .trim()
    .toLowerCase();

  const isProtectedAdminUser = (user) => {
    const email = String(user?.email || '').trim().toLowerCase();
    const name = String(user?.name || '').trim().toLowerCase();
    return email === PROTECTED_ADMIN_EMAIL || name === 'dushyant saini';
  };

  function parseCookies(header) {
    const out = {};
    if (!header) return out;
    const parts = header.split(';');
    for (const part of parts) {
      const [key, ...rest] = part.trim().split('=');
      out[key] = decodeURIComponent(rest.join('=') || '');
    }
    return out;
  }

  function signToken(payload) {
    return fastify.jwt.sign(payload);
  }

  function verifyToken(token) {
    try {
      return fastify.jwt.verify(token);
    } catch {
      return null;
    }
  }

  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const iterations = 100000;
    const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
    return `pbkdf2$${iterations}$${salt}$${hash}`;
  }

  function verifyPassword(password, stored) {
    try {
      const [algo, iterStr, salt, hash] = stored.split('$');
      if (algo !== 'pbkdf2') return false;
      const iterations = parseInt(iterStr, 10);
      const test = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
    } catch {
      return false;
    }
  }

  function setAuthCookie(reply, token) {
    reply.setCookie(AUTH_COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  function clearAuthCookie(reply) {
    const common = {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      expires: new Date(0),
    };
    
    reply.setCookie(AUTH_COOKIE, '', common);

    if (process.env.NODE_ENV === 'production') {
      reply.setCookie(AUTH_COOKIE, '', { ...common, domain: '.mistyvisuals.com' });
      reply.setCookie(AUTH_COOKIE, '', { ...common, domain: 'mistyvisuals.com' });
      reply.setCookie(AUTH_COOKIE, '', { ...common, domain: '.mistyvisuals.in' });
      reply.setCookie(AUTH_COOKIE, '', { ...common, domain: 'mistyvisuals.in' });
    }
  }

  function getAuthFromRequest(req) {
    let token =
      (req.cookies && req.cookies[AUTH_COOKIE]) ||
      parseCookies(req.headers.cookie || '')[AUTH_COOKIE];
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        token = parts[1];
      }
    }
    if (!token) return null;
    return verifyToken(token);
  }

  function requireAuth(req, reply) {
    const auth = getAuthFromRequest(req);
    if (!auth) {
      reply.code(401).send({ error: 'Not authenticated' });
      return null;
    }
    return auth;
  }

  function requireAdmin(req, reply) {
    const auth = requireAuth(req, reply);
    if (!auth) return null;
    const roles = Array.isArray(auth.roles) ? auth.roles : auth.role ? [auth.role] : [];
    if (!roles.includes('admin')) {
      reply.code(403).send({ error: 'Admin only' });
      return null;
    }
    return auth;
  }

  async function requireVendor(req, reply, pool) {
    const auth = requireAuth(req, reply);
    if (!auth) return null;
    const roles = Array.isArray(auth.roles) ? auth.roles : auth.role ? [auth.role] : [];
    if (roles.includes('admin')) {
      reply.code(403).send({ error: 'Vendor portal is not available for admin users' });
      return null;
    }
    const userId = auth.sub;
    if (!userId) {
      reply.code(401).send({ error: 'Not authenticated' });
      return null;
    }
    try {
      const { rows } = await pool.query(`SELECT * FROM vendors WHERE user_id = $1 AND is_active = true`, [userId]);
      if (!rows.length) {
        reply.code(403).send({ error: 'Vendor profile not linked. Contact admin.' });
        return null;
      }
      return { user: { id: userId, email: auth.email, role: auth.role }, roles, vendor: rows[0] };
    } catch (err) {
      reply.code(500).send({ error: 'Server error' });
      return null;
    }
  }

  return {
    PROTECTED_ADMIN_EMAIL,
    isProtectedAdminUser,
    parseCookies,
    signToken,
    verifyToken,
    hashPassword,
    verifyPassword,
    setAuthCookie,
    clearAuthCookie,
    getAuthFromRequest,
    requireAuth,
    requireAdmin,
    requireVendor,
  };
};
