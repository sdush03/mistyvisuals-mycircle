const fs = require('fs');
const path = require('path');
const { prisma } = require('../../prisma');
const qdrant = require('../../utils/qdrant');
const faceRecManager = require('../../utils/faceRecManager');
const { uploadAssetWithRetry } = require('../../utils/r2');
const { guestAnchors, checkUserSelfie, ensureUserSelfieMigrated, getDerivedThumbnail, verifyGuestAuth } = require('./galleryCommon');

module.exports = async function guestAuthMatchingRoutes(fastify, opts) {

  // Verify OAuth tokens (Google/Apple) and register guest
  fastify.post('/api/gallery/public/events/:slug/auth', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const { provider, token, name, email, code } = req.body;

    if (!provider || !token) {
      return reply.code(400).send({ error: 'Provider and token are required' });
    }

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event || !event.active) return reply.code(404).send({ error: 'Event not found or inactive' });

      let verifiedEmail = null;
      let verifiedName = null;
      let providerId = null;

      if (provider === 'google') {
        const verifyResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
        if (!verifyResponse.ok) {
          return reply.code(400).send({ error: 'Invalid Google token' });
        }
        const ticket = await verifyResponse.json();
        verifiedEmail = ticket.email;
        verifiedName = ticket.name || ticket.given_name;
        providerId = ticket.sub;
      } else if (provider === 'apple') {
        verifiedEmail = email;
        verifiedName = name;
        providerId = token;
        if (!verifiedEmail) {
          return reply.code(400).send({ error: 'Apple Auth requires email for first-time login' });
        }
      } else {
        return reply.code(400).send({ error: 'Unsupported authentication provider' });
      }

      const dbPasscode = event.fullCode;
      const dbPartialPasscode = event.partialCode;

      let guest = await prisma.guest.findFirst({
        where: { eventId: event.id, email: verifiedEmail }
      });

      let isCodeValid = false;
      
      if (dbPasscode || dbPartialPasscode) {
        if (!code) {
          if (!guest) {
            return reply.code(400).send({ error: 'Passcode is required to access this gallery' });
          }
        } else {
          const cleanCode = code.trim().toUpperCase();
          const cleanFull = dbPasscode ? dbPasscode.trim().toUpperCase() : null;
          const cleanPartial = dbPartialPasscode ? dbPartialPasscode.trim().toUpperCase() : null;

          if (cleanFull && cleanCode === cleanFull) {
            isCodeValid = true;
          } else if (cleanPartial && cleanCode === cleanPartial) {
            isCodeValid = false;
          } else {
            return reply.code(400).send({ error: 'Invalid passcode' });
          }
        }
      }

      let user = await prisma.circleUser.findUnique({
        where: { email: verifiedEmail }
      });
      if (!user) {
        user = await prisma.circleUser.create({
          data: {
            email: verifiedEmail,
            name: verifiedName,
            provider,
            providerId
          }
        });
      }

      if (!guest) {
        guest = await prisma.guest.create({
          data: {
            eventId: event.id,
            email: verifiedEmail,
            name: user.name,
            phoneNumber: user.phoneNumber,
            provider,
            providerId,
            hasFullAccess: isCodeValid
          }
        });
      } else {
        if (isCodeValid && !guest.hasFullAccess) {
          guest = await prisma.guest.update({
            where: { id: guest.id },
            data: { hasFullAccess: true }
          });
        }
        // Reset LEFT → ACTIVE if guest re-joins (raw SQL bypasses stale Prisma client)
        await prisma.$executeRaw`UPDATE guests SET status = 'ACTIVE', updated_at = NOW() WHERE id = ${guest.id} AND status = 'LEFT'`;
      }

      await ensureUserSelfieMigrated(fastify, user.id, verifiedEmail);
      const hasSelfie = await checkUserSelfie(user.id);

      const sessionToken = fastify.jwt.sign({
        guestId: guest.id,
        userId: user.id,
        eventId: event.id,
        email: guest.email,
        role: 'guest',
        hasFullAccess: guest.hasFullAccess
      }, { expiresIn: '7d' });

      return {
        token: sessionToken,
        guest: {
          id: guest.id,
          name: user.name || guest.name,
          email: guest.email,
          phoneNumber: user.phoneNumber,
          hasFullAccess: guest.hasFullAccess,
          hasSelfie,
          selfieUrl: user.selfieUrl || null
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Authentication failed' });
    }
  });

  // Exchange a global Circle/family session token for a wedding-specific guest session token (Seamless SSO)
  fastify.post('/api/gallery/public/events/:slug/auth-from-family', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(400).send({ error: 'Circle Authorization token is required' });
    }

    const circleToken = authHeader.split(' ')[1];
    const { code } = req.body || {};

    try {
      let decoded;
      try {
        decoded = fastify.jwt.verify(circleToken);
      } catch (jwtErr) {
        return reply.code(401).send({ error: 'Invalid or expired Circle session' });
      }

      if ((decoded.role !== 'family' && decoded.role !== 'guest') || !decoded.email) {
        return reply.code(403).send({ error: 'Access denied: Invalid session role' });
      }

      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event || !event.active) return reply.code(404).send({ error: 'Event not found or inactive' });

      const dbPasscode = event.fullCode;
      const dbPartialPasscode = event.partialCode;

      const user = await prisma.circleUser.findUnique({
        where: { email: decoded.email }
      });
      if (!user && decoded.role === 'family') {
        return reply.code(404).send({ error: 'User profile not found' });
      }

      let guest = await prisma.guest.findFirst({
        where: { eventId: event.id, email: decoded.email }
      });

      let isCodeValid = false;
      
      if (dbPasscode || dbPartialPasscode) {
        if (!code) {
          if (!guest) {
            return reply.code(400).send({ error: 'Passcode is required to access this gallery' });
          }
        } else {
          const cleanCode = code.trim().toUpperCase();
          const cleanFull = dbPasscode ? dbPasscode.trim().toUpperCase() : null;
          const cleanPartial = dbPartialPasscode ? dbPartialPasscode.trim().toUpperCase() : null;

          if (cleanFull && cleanCode === cleanFull) {
            isCodeValid = true;
          } else if (cleanPartial && cleanCode === cleanPartial) {
            isCodeValid = false;
          } else {
            return reply.code(400).send({ error: 'Invalid passcode' });
          }
        }
      }

      const userName = user ? user.name : (guest ? guest.name : 'Guest');
      const userPhone = user ? user.phoneNumber : (guest ? guest.phoneNumber : null);
      const userProvider = user ? user.provider : (guest ? guest.provider : 'circle');
      const userProviderId = user ? user.providerId : (guest ? guest.providerId : 'circle');
      const userId = user ? user.id : (decoded.userId || guest?.id || 0);

      if (!guest) {
        guest = await prisma.guest.create({
          data: {
            eventId: event.id,
            email: decoded.email,
            name: userName,
            phoneNumber: userPhone,
            provider: userProvider,
            providerId: userProviderId,
            hasFullAccess: isCodeValid
          }
        });
      } else {
        if (isCodeValid && !guest.hasFullAccess) {
          guest = await prisma.guest.update({
            where: { id: guest.id },
            data: { hasFullAccess: true }
          });
        }
        // Reset LEFT → ACTIVE if guest re-joins (raw SQL bypasses stale Prisma client)
        await prisma.$executeRaw`UPDATE guests SET status = 'ACTIVE', updated_at = NOW() WHERE id = ${guest.id} AND status = 'LEFT'`;
      }

      if (user) {
        await ensureUserSelfieMigrated(fastify, user.id, decoded.email);
      }
      const hasSelfie = user ? await checkUserSelfie(user.id) : false;

      let resolvedDisplayRole = (guest.displayRole || '').toString().trim().toUpperCase() || null;

      if (!resolvedDisplayRole || resolvedDisplayRole === 'GUEST') {
        const cleanEmail = (guest.email || decoded.email || '').trim().toLowerCase();
        const cleanPhone = (userPhone || guest.phoneNumber || '').replace(/\D/g, '');
        const cleanName = (userName || guest.name || '').trim().toLowerCase();

        try {
          const candidateGuests = await prisma.guest.findMany({
            where: {
              displayRole: { not: null }
            }
          });

          const found = candidateGuests.find(g => {
            const roleUpper = (g.displayRole || '').trim().toUpperCase();
            if (!['BRIDE', 'GROOM', 'COUPLE'].includes(roleUpper)) return false;

            const cgEmail = (g.email || '').trim().toLowerCase();
            const cgPhone = (g.phoneNumber || '').replace(/\D/g, '');
            const cgName = (g.name || '').trim().toLowerCase();

            if (cleanEmail && cgEmail && cgEmail === cleanEmail) return true;
            if (cleanPhone && cgPhone && (cleanPhone.endsWith(cgPhone) || cgPhone.endsWith(cleanPhone))) return true;
            if (cleanName && cgName && cgName.length > 2 && (cleanName.includes(cgName) || cgName.includes(cleanName))) return true;
            return false;
          });

          if (found) {
            resolvedDisplayRole = found.displayRole.trim().toUpperCase();
          }
        } catch (_) {}
      }

      const sessionToken = fastify.jwt.sign({
        guestId: guest.id,
        userId: userId,
        eventId: event.id,
        email: guest.email,
        role: 'guest',
        displayRole: resolvedDisplayRole,
        hasFullAccess: guest.hasFullAccess
      }, { expiresIn: '7d' });

      return {
        token: sessionToken,
        guest: {
          id: guest.id,
          name: userName || guest.name,
          email: guest.email,
          phoneNumber: userPhone,
          hasFullAccess: guest.hasFullAccess,
          displayRole: resolvedDisplayRole,
          hasSelfie,
          selfieUrl: user?.selfieUrl || null
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'SSO transition failed' });
    }
  });

  // Upgrade guest session to Full Access by providing a valid passcode
  fastify.post('/api/gallery/public/events/:slug/upgrade', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const { code } = req.body;

    if (!code) {
      return reply.code(400).send({ error: 'Passcode is required' });
    }

    try {
      const event = req.event || await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event) return reply.code(404).send({ error: 'Event not found' });

      const isCodeValid = event.fullCode && code.trim().toUpperCase() === event.fullCode.trim().toUpperCase();

      if (!isCodeValid) {
        return reply.code(400).send({ error: 'Invalid passcode' });
      }

      const guestId = req.guest.guestId;
      const updatedGuest = await prisma.guest.update({
        where: { id: guestId },
        data: { hasFullAccess: true }
      });

      const sessionToken = fastify.jwt.sign({
        guestId: updatedGuest.id,
        userId: req.guest.userId,
        eventId: event.id,
        email: updatedGuest.email,
        role: 'guest',
        hasFullAccess: true
      }, { expiresIn: '7d' });

      return {
        success: true,
        token: sessionToken,
        guest: {
          id: updatedGuest.id,
          name: updatedGuest.name,
          email: updatedGuest.email,
          phoneNumber: updatedGuest.phoneNumber,
          hasFullAccess: true,
          hasSelfie: await checkUserSelfie(req.guest.userId)
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to upgrade access level' });
    }
  });

  // Store/update guest phone number
  fastify.post('/api/gallery/public/events/:slug/phone', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return reply.code(400).send({ error: 'Phone number is required' });

    try {
      const existingUser = await prisma.circleUser.findFirst({
        where: {
          phoneNumber,
          NOT: { email: req.guest.email }
        }
      });
      if (existingUser) {
        return reply.code(400).send({ error: 'This phone number is already registered with another account.' });
      }

      await prisma.circleUser.update({
        where: { email: req.guest.email },
        data: { phoneNumber }
      });
      await prisma.guest.update({
        where: { id: req.guest.guestId },
        data: { phoneNumber }
      });
      return { status: 'success' };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to update phone number' });
    }
  });

  // Guest upload and verify selfie
  fastify.post('/api/gallery/public/events/:slug/selfie', { preHandler: verifyGuestAuth, bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    const eventId = req.guest.eventId;
    const guestKey = `${req.guest.email}_${eventId}`;
    const userId = req.guest.userId;

    const selfiesDir = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies');
    fs.mkdirSync(selfiesDir, { recursive: true });
    const tempPath = path.join(selfiesDir, `temp_selfie_${userId}_${Date.now()}.jpg`);

    try {
      const data = await req.file();
      if (!data) return reply.code(400).send({ error: 'No image uploaded' });

      const buffer = await data.toBuffer();

      fs.writeFileSync(tempPath, buffer);

      const res = await faceRecManager.validateSelfie(tempPath);

      if (!res.success || !res.vector) {
        return reply.code(400).send({ error: res.error || 'Failed to validate face on selfie' });
      }

      const selfieFilename = `user_${userId}_${Date.now()}.jpg`;
      const selfieUrl = await uploadAssetWithRetry(buffer, selfieFilename, `users/selfies`, 'image/jpeg');

      if (userId) {
        await prisma.circleUser.update({
          where: { id: userId },
          data: { selfieVector: res.vector, selfieUrl }
        }).catch(err => req.log.warn('CircleUser selfie save failed:', err.message));

        const userRecord = await prisma.circleUser.findUnique({ where: { id: userId }, select: { email: true } });
        if (userRecord?.email) {
          const guestProfiles = await prisma.guest.findMany({ where: { email: userRecord.email } });
          for (const g of guestProfiles) {
            const key = `${userRecord.email}_${g.eventId}`;
            guestAnchors[key] = { anchorVector: res.vector, extraVectors: [] };
          }
        }
      } else {
        guestAnchors[guestKey] = { anchorVector: res.vector, extraVectors: [] };
      }

      return { status: 'success', selfieUrl };
    } catch (err) {
      req.log.error('Selfie upload failed:', err.message);
      return reply.code(500).send({ error: err.message || 'Failed to upload selfie' });
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  });

  // Get matched photos of the guest using their saved selfie vector
  fastify.get('/api/gallery/public/events/:slug/matched-photos', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const eventId = req.guest.eventId;
    const guestKey = `${req.guest.email}_${eventId}`;
    const userId = req.guest.userId;
    const guestId = req.guest.guestId;

    try {
      const event = req.event || await prisma.galleryEvent.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: 'Event not found' });

      let anchorVector = guestAnchors[guestKey]?.anchorVector;

      if (!anchorVector) {
        const circleUser = await prisma.circleUser.findUnique({
          where: { id: userId },
          select: { selfieVector: true }
        });

        if (circleUser?.selfieVector) {
          anchorVector = circleUser.selfieVector;
          guestAnchors[guestKey] = { anchorVector, extraVectors: [] };
        }
      }

      if (!anchorVector) {
        return { photos: [] };
      }

      const extraVectors = guestAnchors[guestKey].extraVectors || [];

      const validPhotos = await prisma.photo.findMany({
        where: { eventId },
        select: { id: true }
      });
      const validPhotoIds = new Set(validPhotos.map(p => p.id));

      let photoIds = [];
      if (qdrant.isMock) {
        let dbVectors = qdrant.mockCache
          .filter(item => item.eventId === eventId && validPhotoIds.has(item.photoId))
          .map(item => ({
            photoId: item.photoId,
            faceId: item.faceId,
            vector: item.vector
          }));

        if (dbVectors.length > 0) {
          try {
            const res = await faceRecManager.matchSelfie(anchorVector, dbVectors, extraVectors);
            if (res.matches) {
              photoIds = res.matches.map(m => m.photoId);
            }
          } catch (matchErr) {
            req.log.error('Match execution failed for saved selfie:', matchErr.message);
          }
        }
      } else {
        const mainMatches = await qdrant.searchVectors(eventId, anchorVector, 100000, 0.35);
        const photoIdsSet = new Set(mainMatches.map(m => m.photo_id));
        
        for (const extraVec of extraVectors) {
          const extraMatches = await qdrant.searchVectors(eventId, extraVec, 100000, 0.35);
          extraMatches.forEach(m => photoIdsSet.add(m.photo_id));
        }
        photoIds = Array.from(photoIdsSet);
      }

      if (photoIds.length === 0 && (process.env.NODE_ENV === 'development' || process.env.MOCK_AI === 'true')) {
        const fallbackPhotos = await prisma.photo.findMany({
          where: { eventId },
          take: 3
        });
        photoIds = fallbackPhotos.map(p => p.id);
      }

      const photos = await prisma.photo.findMany({
        where: { id: { in: photoIds } },
        select: {
          id: true,
          r2Url: true,
          thumbnailUrl: true,
          filename: true,
          originalFileSize: true,
          tabName: true,
          capturedAt: true,
          width: true,
          height: true,
          _count: {
            select: {
              likes: true
            }
          },
          likes: {
            where: { guestId },
            select: { id: true }
          }
        },
        orderBy: [
          { capturedAt: 'asc' },
          { id: 'asc' }
        ]
      });

      const mappedPhotos = photos.map(p => ({
        id: p.id,
        r2Url: p.r2Url,
        thumbnailUrl: getDerivedThumbnail(p.thumbnailUrl, p.r2Url),
        filename: p.filename,
        originalSize: p.originalFileSize,
        tabName: p.tabName,
        capturedAt: p.capturedAt,
        width: p.width,
        height: p.height,
        likeCount: p._count?.likes || 0,
        isLiked: p.likes && p.likes.length > 0
      }));

      try {
        await prisma.guest.update({
          where: { id: guestId },
          data: { matchCount: mappedPhotos.length }
        });
      } catch (err) {
        req.log.warn('Failed to save matchCount for guest:', err.message);
      }

      return { photos: mappedPhotos };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve matched photos' });
    }
  });

  // Dynamic live search on uploaded selfie vector (Option B)
  fastify.post('/api/gallery/public/events/:slug/search', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const eventId = req.guest.eventId;
    const guestKey = `${req.guest.email}_${eventId}`;
    const guestId = req.guest.guestId;
    const userId = req.guest.userId;

    let tempPath = null;

    try {
      const data = await req.file();
      if (!data) return reply.code(400).send({ error: 'No selfie image provided' });

      const buffer = await data.toBuffer();
      const tempDir = path.join(__dirname, '..', '..', 'uploads', 'temp');
      fs.mkdirSync(tempDir, { recursive: true });
      tempPath = path.join(tempDir, `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`);
      fs.writeFileSync(tempPath, buffer);

      const res = await faceRecManager.validateSelfie(tempPath);

      if (!res.success || !res.vector) {
        return reply.code(400).send({ error: res.error || 'Failed to detect face on image' });
      }

      if (!guestAnchors[guestKey]) {
        const circleUser = await prisma.circleUser.findUnique({
          where: { id: userId },
          select: { selfieVector: true }
        });
        const anchorVector = circleUser?.selfieVector || null;
        guestAnchors[guestKey] = { anchorVector, extraVectors: [] };
      }

      guestAnchors[guestKey].extraVectors.push(res.vector);

      const validPhotos = await prisma.photo.findMany({
        where: { eventId },
        select: { id: true }
      });
      const validPhotoIds = new Set(validPhotos.map(p => p.id));

      let photoIds = [];
      if (qdrant.isMock) {
        let dbVectors = qdrant.mockCache
          .filter(item => item.eventId === eventId && validPhotoIds.has(item.photoId))
          .map(item => ({
            photoId: item.photoId,
            faceId: item.faceId,
            vector: item.vector
          }));

        if (dbVectors.length > 0) {
          const anchorVector = guestAnchors[guestKey].anchorVector || res.vector;
          const matchRes = await faceRecManager.matchSelfie(anchorVector, dbVectors, guestAnchors[guestKey].extraVectors);
          if (matchRes.matches) {
            photoIds = matchRes.matches.map(m => m.photoId);
          }
        }
      } else {
        const mainVector = guestAnchors[guestKey].anchorVector || res.vector;
        const mainMatches = await qdrant.searchVectors(eventId, mainVector, 100000, 0.35);
        const photoIdsSet = new Set(mainMatches.map(m => m.photo_id));

        for (const extraVec of guestAnchors[guestKey].extraVectors) {
          const extraMatches = await qdrant.searchVectors(eventId, extraVec, 100000, 0.35);
          extraMatches.forEach(m => photoIdsSet.add(m.photo_id));
        }
        photoIds = Array.from(photoIdsSet);
      }

      const photos = await prisma.photo.findMany({
        where: { id: { in: photoIds } },
        select: {
          id: true,
          r2Url: true,
          thumbnailUrl: true,
          filename: true,
          originalFileSize: true,
          tabName: true,
          capturedAt: true,
          width: true,
          height: true,
          _count: {
            select: {
              likes: true
            }
          },
          likes: {
            where: { guestId },
            select: { id: true }
          }
        },
        orderBy: [
          { capturedAt: 'asc' },
          { id: 'asc' }
        ]
      });

      const mappedPhotos = photos.map(p => ({
        id: p.id,
        r2Url: p.r2Url,
        thumbnailUrl: getDerivedThumbnail(p.thumbnailUrl, p.r2Url),
        filename: p.filename,
        originalSize: p.originalFileSize,
        tabName: p.tabName,
        capturedAt: p.capturedAt,
        width: p.width,
        height: p.height,
        likeCount: p._count?.likes || 0,
        isLiked: p.likes && p.likes.length > 0
      }));

      return { photos: mappedPhotos };
    } catch (err) {
      req.log.error('Option B live face search failed:', err.message);
      return reply.code(500).send({ error: 'Search failed' });
    } finally {
      if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  });

  // Verify anchor vector and add extra face features (Option B)
  fastify.post('/api/gallery/public/events/:slug/verify-anchor', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const eventId = req.guest.eventId;
    const guestKey = `${req.guest.email}_${eventId}`;
    const { action } = req.body;

    if (!guestAnchors[guestKey] || !guestAnchors[guestKey].extraVectors || guestAnchors[guestKey].extraVectors.length === 0) {
      return { status: 'ok', message: 'No extra vectors to verify' };
    }

    if (action === 'accept') {
      guestAnchors[guestKey].extraVectors = [];
      return { status: 'accepted', message: 'Anchor vector verified and retained' };
    } else {
      guestAnchors[guestKey].extraVectors.pop();
      return { status: 'rejected', message: 'Last search face vector discarded' };
    }
  });
};
