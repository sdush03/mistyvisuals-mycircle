const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prisma } = require('../../prisma');
const qdrant = require('../../utils/qdrant');
const faceRecManager = require('../../utils/faceRecManager');
const { uploadAssetWithRetry } = require('../../utils/r2');
const { verifyAppleToken } = require('../../utils/appleAuth');
const { createRateLimiter, getClientIp } = require('../../utils/rateLimiter');
const {
  checkUserSelfie,
  ensureUserSelfieMigrated,
  guestAnchors,
  verifyGuestAuth,
  verifyFamilyAuth,
} = require('./galleryCommon');

const familyAuthRateLimiter = createRateLimiter({
  name: 'family_auth',
  timeWindowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${getClientIp(req)}:${req.body?.email || req.body?.phoneNumber || ''}`,
  errorMessage: 'Too many login attempts. Please wait 15 minutes.'
});

module.exports = async function familyRoutes(fastify, opts) {
  const { requireAdmin } = opts;

  // Verify OAuth (Google/Apple/Facebook/Phone) token globally for Family Dashboard
  fastify.post('/api/gallery/family/auth', { preHandler: familyAuthRateLimiter }, async (req, reply) => {
    const { token, provider = 'google', email: inputEmail, name: inputName, phoneNumber, appleUserId } = req.body;
    if (!token && !phoneNumber) return reply.code(400).send({ error: 'Token or Phone Number is required' });

    try {
      let verifiedEmail = inputEmail || null;
      let verifiedName = inputName || 'Misty Guest';
      let providerId = token || phoneNumber;

      if (provider === 'google') {
        const isDev = process.env.NODE_ENV === 'development';
        if (isDev && token && token.startsWith('google_auth_')) {
          verifiedEmail = inputEmail || token.replace('google_auth_', '');
          verifiedName = inputName || 'Google User';
          providerId = verifiedEmail;
        } else {
          const verifyResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
          if (!verifyResponse.ok) {
            return reply.code(400).send({ error: 'Invalid Google token' });
          }
          const ticket = await verifyResponse.json();
          verifiedEmail = ticket.email;
          verifiedName = ticket.name || ticket.given_name || verifiedName;
          providerId = ticket.sub;
        }
      } else if (provider === 'apple') {
        const appleClaims = await verifyAppleToken(token);

        if (!appleClaims) {
          return reply.code(400).send({ error: 'Invalid Apple identity token' });
        }

        const stableId = appleClaims.sub;
        if (appleUserId && appleUserId !== stableId) {
          return reply.code(400).send({ error: 'Apple user ID mismatch' });
        }

        verifiedEmail = appleClaims.email || inputEmail || `apple_${stableId}@privaterelay.appleid.com`;
        verifiedName = inputName || 'Apple User';
        providerId = stableId;
      } else if (provider === 'facebook') {
        verifiedEmail = inputEmail || `fb_${Date.now()}@facebook.com`;
        verifiedName = inputName || 'Facebook User';
      } else if (provider === 'phone') {
        const phoneFormatted = phoneNumber || token;
        verifiedEmail = `${phoneFormatted.replace(/[^0-9]/g, '')}@phone.mistyvisuals.com`;
        verifiedName = inputName || `User ${phoneFormatted.slice(-4)}`;
      }

      let user = null;

      // Step 1: For Apple sign-in, look up by stable Apple user ID first.
      // This handles returning users whose email is null on 2nd+ logins.
      if (provider === 'apple' && appleUserId) {
        user = await prisma.circleUser.findFirst({ where: { providerId: appleUserId } });
      }

      // Step 2: Fall back to email lookup
      if (!user && verifiedEmail) {
        user = await prisma.circleUser.findUnique({ where: { email: verifiedEmail } });

        // If found by email but Apple user ID not yet stored, save it now
        // so future logins (when email is null) can find this user by providerId
        if (user && provider === 'apple' && appleUserId && user.providerId !== appleUserId) {
          await prisma.circleUser.update({
            where: { id: user.id },
            data: { providerId: appleUserId }
          });
        }
      }

      // Step 3: Fall back to phone number lookup
      if (!user && phoneNumber) {
        user = await prisma.circleUser.findFirst({ where: { phoneNumber } });
      }

      if (!user) {
        user = await prisma.circleUser.create({
          data: {
            email: verifiedEmail,
            name: verifiedName,
            phoneNumber: phoneNumber || (provider === 'phone' ? (phoneNumber || token) : null),
            provider: provider,
            providerId: providerId || 'global'
          }
        });
      }

      const familyToken = fastify.jwt.sign({
        email: user.email,
        role: 'family',
        name: user.name || verifiedName,
        userId: user.id
      }, { expiresIn: '7d' });

      return {
        token: familyToken,
        profile: {
          id: user.id,
          name: user.name || verifiedName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          hasSelfie: await checkUserSelfie(user.id),
          selfieGuestId: user.id
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Global authentication failed' });
    }
  });

  // Exchange an existing event guest JWT for a family JWT
  fastify.post('/api/gallery/family/auth-from-event', async (req, reply) => {
    const { eventToken } = req.body;
    if (!eventToken) return reply.code(400).send({ error: 'Event token is required' });

    try {
      let decoded;
      try {
        decoded = fastify.jwt.verify(eventToken);
      } catch (e) {
        return reply.code(401).send({ error: 'Invalid or expired event token' });
      }

      if (decoded.role !== 'guest' || !decoded.email) {
        return reply.code(403).send({ error: 'Invalid token role' });
      }

      const { email, guestId } = decoded;

      const guest = await prisma.guest.findUnique({ where: { id: guestId } });
      if (!guest) return reply.code(404).send({ error: 'Guest not found' });

      // Automatically reset status from LEFT to ACTIVE when guest returns
      await prisma.$executeRaw`UPDATE guests SET status = 'ACTIVE', updated_at = NOW() WHERE id = ${guest.id} AND status = 'LEFT'`.catch(() => {});

      let user = await prisma.circleUser.findUnique({
        where: { email }
      });
      if (!user) {
        user = await prisma.circleUser.create({
          data: {
            email,
            name: guest.name,
            phoneNumber: guest.phoneNumber,
            provider: guest.provider || 'google',
            providerId: guest.providerId || 'global'
          }
        });
      }

      await ensureUserSelfieMigrated(fastify, user.id, email);
      const hasSelfie = await checkUserSelfie(user.id);
      // Fetch deleted_at via raw SQL — column not in Prisma schema
      const [deletionRow] = await prisma.$queryRaw`SELECT deleted_at FROM circle_users WHERE id = ${user.id}`;
      const isDeactivated = !!(deletionRow?.deleted_at);

      const familyToken = fastify.jwt.sign({
        email,
        role: 'family',
        name: guest.name,
        userId: user.id
      }, { expiresIn: '7d' });

      return {
        token: familyToken,
        profile: {
          id: user.id,
          name: user.name || guest.name,
          email,
          phoneNumber: isDeactivated ? null : (user.phoneNumber || guest.phoneNumber),
          hasSelfie: isDeactivated ? false : hasSelfie,
          selfieGuestId: user.id,
          selfieUrl: isDeactivated ? null : (user.selfieUrl || null)
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Token exchange failed' });
    }
  });

  // Get all events linked to the family guest account
  fastify.get('/api/gallery/family/events', { preHandler: verifyFamilyAuth }, async (req, reply) => {
    const email = req.family.email;

    try {
      const user = await prisma.circleUser.findUnique({
        where: { email }
      });
      if (!user) return { events: [], profile: null };

      const guestProfiles = await prisma.guest.findMany({
        where: { email },
        include: { galleryEvent: true }
      });

      // Fetch LEFT status separately via raw SQL (Prisma client may not have status yet)
      const leftRows = await prisma.$queryRaw`
        SELECT id FROM guests WHERE email = ${email} AND status = 'LEFT'
      `;
      const leftIds = new Set(leftRows.map((r) => r.id));

      const eventsList = [];
      const selfiesDir = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies');
      const selfiePath = path.join(selfiesDir, `user_${user.id}.jpg`);
      const vectorPath = path.join(selfiesDir, `user_${user.id}.json`);
      let anchorVector = null;

      if (fs.existsSync(selfiePath) && fs.existsSync(vectorPath)) {
        try {
          anchorVector = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));
        } catch (e) {
          req.log.error('Failed to parse anchor vector:', e);
        }
      }

      for (const g of guestProfiles) {
        if (leftIds.has(g.id) || g.status === 'LEFT') continue;
        const event = g.galleryEvent;
        if (!event || !event.active || event.slug === 'system-directory') continue;

        let matchedCount = 0;

        if (anchorVector) {
          try {
            if (qdrant.isMock) {
              const validPhotos = await prisma.photo.findMany({
                where: { eventId: event.id },
                select: { id: true }
              });
              const validPhotoIds = new Set(validPhotos.map(p => p.id));
              const dbVectors = qdrant.mockCache
                .filter(item => item.eventId === event.id && validPhotoIds.has(item.photoId))
                .map(item => ({
                  photoId: item.photoId,
                  faceId: item.faceId,
                  vector: item.vector
                }));
              if (dbVectors.length > 0) {
                const res = await faceRecManager.matchSelfie(selfiePath, dbVectors, []);
                if (res.matches) {
                  matchedCount = res.matches.length;
                }
              }
            } else {
              const mainMatches = await qdrant.searchVectors(event.id, anchorVector, 100000, 0.35);
              const matchedPhotoIds = new Set(mainMatches.map(m => m.photo_id));
              matchedCount = matchedPhotoIds.size;
            }
          } catch (matchErr) {
            req.log.warn(`matchedCount computation failed for event ${event.id}:`, matchErr.message);
          }
        }

        let highlightsPhotoCount = 0;
        try {
          highlightsPhotoCount = await prisma.photo.count({
            where: { eventId: event.id, tabName: 'Highlights' }
          });
        } catch (e) {
          req.log.warn(`highlightsPhotoCount failed for event ${event.id}:`, e.message);
        }

        let totalPhotoCount = 0;
        try {
          totalPhotoCount = await prisma.photo.count({
            where: { eventId: event.id }
          });
        } catch (e) {
          req.log.warn(`totalPhotoCount failed for event ${event.id}:`, e.message);
        }

        const eventDate = new Date(event.date);
        const today = new Date();
        const isSameDay = eventDate.getUTCFullYear() === today.getUTCFullYear() &&
          eventDate.getUTCMonth() === today.getUTCMonth() &&
          eventDate.getUTCDate() === today.getUTCDate();

        // Derive stage from actual photo counts — event.stage / highlightsReady / isHighlights
        // do NOT exist on GalleryEvent in the schema, so counts are the only reliable signal.
        const hasHighlightsPhotos = highlightsPhotoCount > 0;
        let stage;
        if (isSameDay) {
          stage = 'LIVE';
        } else if (eventDate > today) {
          stage = 'UPCOMING';
        } else if (hasHighlightsPhotos) {
          stage = 'HIGHLIGHTS';
        } else if (totalPhotoCount > 0) {
          stage = 'READY';
        } else {
          stage = 'CURATING';
        }

        let resolvedDisplayRole = (g.displayRole || '').toString().trim().toUpperCase() || null;
        if (!resolvedDisplayRole || resolvedDisplayRole === 'GUEST') {
          const cleanEmail = (g.email || '').trim().toLowerCase();
          const cleanPhone = (g.phoneNumber || '').replace(/\D/g, '');
          const cleanName = (g.name || '').trim().toLowerCase();

          try {
            const found = guestProfiles.find(p => {
              if (p.eventId !== g.eventId) return false;
              const roleUpper = (p.displayRole || '').trim().toUpperCase();
              if (!['BRIDE', 'GROOM', 'COUPLE'].includes(roleUpper)) return false;

              const cgEmail = (p.email || '').trim().toLowerCase();
              const cgPhone = (p.phoneNumber || '').replace(/\D/g, '');

              if (cleanEmail && cgEmail && cleanEmail === cgEmail) return true;
              if (cleanPhone && cgPhone && cleanPhone.length >= 10 && cgPhone.length >= 10 && cleanPhone === cgPhone) return true;
              return false;
            });
            if (found) {
              resolvedDisplayRole = found.displayRole.trim().toUpperCase();
            }
          } catch (_) {}
        }

        const eventToken = fastify.jwt.sign({
          guestId: g.id,
          userId: user.id,
          eventId: event.id,
          email: g.email,
          role: 'guest',
          displayRole: resolvedDisplayRole,
          hasFullAccess: g.hasFullAccess
        }, { expiresIn: '7d' });

        eventsList.push({
          id: event.id,
          title: event.title,
          slug: event.slug,
          date: event.date,
          stage,
          coverPhotoUrl: event.coverPhotoUrl,
          coverPhotoMobileUrl: event.coverPhotoMobileUrl,
          coverPhotoSquareUrl: event.coverPhotoSquareUrl,
          matchedCount,
          highlightsPhotoCount,
          totalPhotoCount,
          eventToken,
          galleryFacesComplete: event.galleryFacesComplete,
          guestInfo: {
            id: g.id,
            name: user.name || g.name,
            email: g.email,
            phoneNumber: user.phoneNumber,
            hasFullAccess: g.hasFullAccess,
            displayRole: resolvedDisplayRole,
            hasSelfie: !!anchorVector
          }
        });
      }

      eventsList.sort((a, b) => {
        const timeA = a.date ? new Date(a.date).getTime() : 0;
        const timeB = b.date ? new Date(b.date).getTime() : 0;
        return timeB - timeA;
      });

      // Fetch deleted_at via raw SQL — column not in Prisma schema
      const [deletionRow] = await prisma.$queryRaw`SELECT deleted_at FROM circle_users WHERE id = ${user.id}`;
      const isDeactivated = !!(deletionRow?.deleted_at);

      return {
        events: eventsList,
        selfieUrl: isDeactivated ? null : (user.selfieUrl || null),
        profile: {
          name: user.name,
          email,
          phoneNumber: isDeactivated ? null : user.phoneNumber,
          hasSelfie: isDeactivated ? false : !!(user.selfieVector || user.selfieUrl),
          selfieGuestId: user.id,
          selfieUrl: isDeactivated ? null : (user.selfieUrl || null)
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to fetch family events' });
    }
  });

  async function updateGuestProfileGlobal(email, name, phoneNumber, selfieBuffer, log) {
    if (phoneNumber) {
      const existingUser = await prisma.circleUser.findFirst({
        where: {
          phoneNumber,
          NOT: { email }
        }
      });
      if (existingUser) {
        throw new Error('This phone number is already registered with another account.');
      }
    }

    let user = await prisma.circleUser.findUnique({
      where: { email }
    });

    if (!user) {
      user = await prisma.circleUser.create({
        data: {
          email,
          name: name || undefined,
          phoneNumber: phoneNumber || undefined
        }
      });
    } else {
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;

      if (Object.keys(updateData).length > 0) {
        user = await prisma.circleUser.update({
          where: { email },
          data: updateData
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;

    if (Object.keys(updateData).length > 0) {
      await prisma.guest.updateMany({
        where: { email },
        data: updateData
      });
    }

    let hasSelfie = await checkUserSelfie(user.id);

    if (selfieBuffer) {
      const selfiesDir = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies');
      fs.mkdirSync(selfiesDir, { recursive: true });

      const tempPath = path.join(selfiesDir, `temp_profile_verify_${Date.now()}.jpg`);

      try {
        fs.writeFileSync(tempPath, selfieBuffer);
        const res = await faceRecManager.validateSelfie(tempPath);

        if (res.success && res.vector) {
          const selfieFilename = `user_${user.id}_${Date.now()}.jpg`;
          const selfieUrl = await uploadAssetWithRetry(selfieBuffer, selfieFilename, `users/selfies`, 'image/jpeg');

          // Save selfie via Prisma (handles vector type correctly)
          await prisma.circleUser.update({
            where: { id: user.id },
            data: { selfieVector: res.vector, selfieUrl }
          }).catch(err => log.warn('CircleUser selfie save failed:', err.message));

          // Clear deactivation flag separately so it always runs even if selfie save fails
          await prisma.$executeRaw`
            UPDATE circle_users SET deleted_at = NULL, deletion_reason = NULL WHERE id = ${user.id}
          `.catch(err => log.warn('Clear deleted_at failed:', err.message));

          const guestProfiles = await prisma.guest.findMany({ where: { email } });
          for (const g of guestProfiles) {
            const guestKey = `${email}_${g.eventId}`;
            guestAnchors[guestKey] = { anchorVector: res.vector, extraVectors: [] };

            await prisma.galleryEvent.update({
              where: { id: g.eventId },
              data: { clustersDirty: true }
            }).catch(() => {});
          }

          hasSelfie = true;
        } else {
          throw new Error(res.error || 'Failed to validate face on selfie');
        }
      } catch (err) {
        log.error('Face validation failed: ' + err.message);
        throw new Error(err.message || 'Failed to run facial verification');
      } finally {
        if (tempPath && fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (_) {}
        }
      }
    }

    return {
      name: user.name,
      email,
      phoneNumber: user.phoneNumber,
      hasSelfie,
      selfieGuestId: user.id
    };
  }

  async function parseProfileUpdateParams(req) {
    let name = undefined;
    let phoneNumber = undefined;
    let selfieBuffer = null;

    if (req.isMultipart()) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.file) {
          selfieBuffer = await part.toBuffer();
        } else {
          if (part.fieldname === 'name') name = part.value;
          if (part.fieldname === 'phoneNumber') phoneNumber = part.value;
        }
      }
    } else {
      name = req.body?.name;
      phoneNumber = req.body?.phoneNumber;
    }

    return { name, phoneNumber, selfieBuffer };
  }

  // Update profile from Circle dashboard
  fastify.post('/api/gallery/family/profile/update', { preHandler: verifyFamilyAuth }, async (req, reply) => {
    try {
      const { name, phoneNumber, selfieBuffer } = await parseProfileUpdateParams(req);
      const profile = await updateGuestProfileGlobal(req.family.email, name, phoneNumber, selfieBuffer, req.log);
      return { success: true, profile };
    } catch (err) {
      req.log.error(err);
      return reply.code(400).send({ error: err.message || 'Failed to update profile' });
    }
  });

  // Update profile from public gallery event page
  fastify.post('/api/gallery/public/events/:slug/profile/update', { preHandler: verifyGuestAuth }, async (req, reply) => {
    try {
      const { name, phoneNumber, selfieBuffer } = await parseProfileUpdateParams(req);
      const profile = await updateGuestProfileGlobal(req.guest.email, name, phoneNumber, selfieBuffer, req.log);
      return { success: true, profile };
    } catch (err) {
      req.log.error(err);
      return reply.code(400).send({ error: err.message || 'Failed to update profile' });
    }
  });

  // Get current guest profile details
  fastify.get('/api/gallery/public/events/:slug/profile', { preHandler: verifyGuestAuth }, async (req, reply) => {
    try {
      const guest = await prisma.guest.findUnique({
        where: { id: req.guest.guestId }
      });
      if (!guest) return reply.code(404).send({ error: 'Guest not found' });

      // Automatically reset status from LEFT to ACTIVE when guest re-enters
      await prisma.$executeRaw`UPDATE guests SET status = 'ACTIVE', updated_at = NOW() WHERE id = ${guest.id} AND status = 'LEFT'`.catch(() => {});

      let user = await prisma.circleUser.findUnique({
        where: { email: guest.email }
      });

      if (!user) {
        user = await prisma.circleUser.create({
          data: {
            email: guest.email,
            name: guest.name,
            phoneNumber: guest.phoneNumber,
            provider: guest.provider,
            providerId: guest.providerId
          }
        });
      }

      return {
        profile: {
          id: guest.id,
          name: user.name || guest.name,
          email: guest.email,
          phoneNumber: user.phoneNumber,
          hasFullAccess: guest.hasFullAccess,
          hasSelfie: await checkUserSelfie(user.id),
          selfieGuestId: user.id
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to fetch guest profile' });
    }
  });

  // Get guest selfie file
  fastify.get('/api/gallery/family/selfie/:guestId', async (req, reply) => {
    const guestId = parseInt(req.params.guestId);
    if (isNaN(guestId)) return reply.code(400).send({ error: 'Invalid user ID' });

    if (guestId === 999999) {
      return reply.code(404).send({ error: 'Selfie not found' });
    }

    let authedEmail = null;
    let isAdmin = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      let signatureVerified = false;
      try {
        const parts = token.split('.');
        if (parts.length === 2) {
          const payloadStr = Buffer.from(parts[0], 'base64url').toString('utf8');
          const signature = parts[1];
          const sharedSecret = crypto.createHash('sha256').update(process.env.DATABASE_URL || 'fallback-secret-key').digest('hex');
          const expectedSig = crypto.createHmac('sha256', sharedSecret).update(payloadStr).digest('hex');
          if (signature === expectedSig) {
            const payload = JSON.parse(payloadStr);
            if (Math.abs(Date.now() - payload.timestamp) < 300000 && payload.guestId === guestId) {
              isAdmin = true;
              signatureVerified = true;
            }
          }
        }
      } catch (err) {
        req.log.warn(`HMAC validation error: ${err.message}`);
      }

      if (!signatureVerified) {
        try {
          const decoded = fastify.jwt.verify(token);
          if (decoded.role === 'guest' && decoded.email) {
            authedEmail = decoded.email;
          } else if (decoded.role === 'family' && decoded.email) {
            authedEmail = decoded.email;
          } else {
            return reply.code(403).send({ error: 'Access denied' });
          }
        } catch (err) {
          return reply.code(401).send({ error: 'Invalid or expired token' });
        }
      }
    } else {
      const adminAuth = requireAdmin(req, reply);
      if (!adminAuth) return;
      isAdmin = true;
    }

    let resolvedUserId = guestId;

    if (!isAdmin) {
      const userById = await prisma.circleUser.findUnique({ where: { id: guestId } });
      
      const dbGuest = await prisma.guest.findUnique({ where: { id: guestId } });
      const userByGuest = dbGuest 
        ? await prisma.circleUser.findUnique({ where: { email: dbGuest.email } })
        : null;

      let matchedUser = null;
      if (userById && userById.email === authedEmail) {
        matchedUser = userById;
      } else if (userByGuest && userByGuest.email === authedEmail) {
        matchedUser = userByGuest;
      }

      if (!matchedUser) {
        return reply.code(403).send({ error: 'You can only view your own selfie' });
      }
      resolvedUserId = matchedUser.id;
    } else {
      const dbGuest = await prisma.guest.findUnique({ where: { id: guestId } });
      if (dbGuest) {
        const linkedUser = await prisma.circleUser.findUnique({ where: { email: dbGuest.email } });
        if (linkedUser) {
          resolvedUserId = linkedUser.id;
        }
      } else {
        const user = await prisma.circleUser.findUnique({ where: { id: guestId } });
        if (user) resolvedUserId = user.id;
      }
    }

    const targetUser = await prisma.circleUser.findUnique({ where: { id: resolvedUserId }, select: { selfieUrl: true } });
    if (targetUser && targetUser.selfieUrl && targetUser.selfieUrl.startsWith('http')) {
      try {
        const imgRes = await fetch(targetUser.selfieUrl);
        if (imgRes.ok) {
          const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
          const buffer = await imgRes.arrayBuffer();
          return reply
            .type(contentType)
            .header('Cache-Control', 'public, max-age=86400')
            .send(Buffer.from(buffer));
        }
      } catch (e) {
        req.log.warn(`Failed to proxy selfie from remote URL ${targetUser.selfieUrl}: ${e.message}`);
      }
    }

    let selfiePath = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies', `user_${resolvedUserId}.jpg`);
    if (!fs.existsSync(selfiePath)) {
      const fallbackPath = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies', `guest_${guestId}.jpg`);
      if (fs.existsSync(fallbackPath)) {
        selfiePath = fallbackPath;
      } else {
        const fallbackResolvedPath = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies', `guest_${resolvedUserId}.jpg`);
        if (fs.existsSync(fallbackResolvedPath)) {
          selfiePath = fallbackResolvedPath;
        } else {
          return reply.code(404).send({ error: 'Selfie not found' });
        }
      }
    }
    reply.type('image/jpeg');
    return reply.send(fs.createReadStream(selfiePath));
  });

  // Soft-Delete / Deactivate Account endpoint
  fastify.post('/api/gallery/family/delete-account', { preHandler: verifyFamilyAuth }, async (req, reply) => {
    try {
      const email = req.family?.email || req.body?.email;
      if (!email) {
        return reply.code(400).send({ error: 'User email is required' });
      }

      const { reason } = req.body || {};
      req.log.info(`[DELETE ACCOUNT 🗑️] Processing deactivation for: ${email}. Reason: ${reason || 'user_requested'}`);

      // 1. Soft-delete: stamp deleted_at ONLY. All user data (phone, selfie, face vector) is preserved.
      const user = await prisma.circleUser.findUnique({ where: { email } });
      if (user) {
        await prisma.$executeRaw`
          UPDATE circle_users
          SET deleted_at      = NOW(),
              deletion_reason = ${reason || 'user_requested'}
          WHERE id = ${user.id}
        `;
      }

      // 2. Mark all joined guest entries for this email as LEFT (clears active event sessions)
      await prisma.$executeRaw`UPDATE guests SET status = 'LEFT', updated_at = NOW() WHERE email = ${email}`.catch(() => {});

      req.log.info(`[DELETE ACCOUNT ✅] Successfully deactivated account and reset onboarding state for: ${email}`);

      return {
        success: true,
        message: 'Account deactivated successfully. Onboarding state has been reset.',
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to process account deactivation' });
    }
  });
};

