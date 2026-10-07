const fs = require('fs');
const path = require('path');
const { prisma } = require('../../prisma');
const qdrant = require('../../utils/qdrant');
const faceRecManager = require('../../utils/faceRecManager');
const { checkPreviewToken, getDerivedThumbnail, verifyGuestAuth, isMobileAppRequest } = require('./galleryCommon');

function purgeOrphanedFacesBackground(log) {
  setTimeout(() => {
    try {
      const targetDir = path.join(__dirname, '..', '..', 'uploads', 'photos');
      if (!fs.existsSync(targetDir)) return;

      const activeFaceIds = new Set();
      if (qdrant.isMock) {
        qdrant.mockCache.forEach(item => {
          if (item.faceId) activeFaceIds.add(item.faceId);
        });
      }

      const files = fs.readdirSync(targetDir);
      let purged = 0;
      for (const file of files) {
        if (file.startsWith('face-')) {
          let faceId = path.parse(file).name;
          if (faceId.endsWith('.jpg')) {
            faceId = faceId.slice(0, -4);
          }
          if (!activeFaceIds.has(faceId)) {
            const filepath = path.join(targetDir, file);
            try {
              fs.unlinkSync(filepath);
              purged++;
            } catch (e) {}
          }
        }
      }
      if (purged > 0) {
        log.info(`Background garbage collector purged ${purged} orphaned face files.`);
      }
    } catch (e) {
      log.error('Failed to run background faces purge:', e);
    }
  }, 100);
}

const deferredInvites = new Map();

// Cleanup expired deferred invites every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of deferredInvites.entries()) {
    if (now - val.timestamp > 15 * 60 * 1000) {
      deferredInvites.delete(key);
    }
  }
}, 5 * 60 * 1000);

function getClientFingerprintKey(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
  const ua = req.headers['user-agent'] || '';
  return `${ip}::${ua.slice(0, 150)}`;
}

module.exports = async function publicGalleryRoutes(fastify, opts) {
  const { requireAdmin } = opts;

  // Record pending gallery invite from web click for zero-prompt deferred deep linking
  fastify.post('/api/gallery/public/record-invite', async (req, reply) => {
    const { slug, code } = req.body || {};
    if (!slug) return reply.code(400).send({ error: 'Missing slug' });
    const key = getClientFingerprintKey(req);
    deferredInvites.set(key, { slug, passcode: code || null, timestamp: Date.now() });
    return { success: true };
  });

  // Consume deferred invite when mobile app opens for the first time
  fastify.get('/api/gallery/public/consume-deferred-invite', async (req, reply) => {
    const key = getClientFingerprintKey(req);
    const match = deferredInvites.get(key);
    if (match) {
      deferredInvites.delete(key);
      if (Date.now() - match.timestamp < 15 * 60 * 1000) {
        return { found: true, slug: match.slug, passcode: match.passcode };
      }
    }

    // IP-based fallback if user agent differs slightly between Safari and App network stack
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
    if (ip) {
      for (const [k, val] of deferredInvites.entries()) {
        if (k.startsWith(`${ip}::`) && Date.now() - val.timestamp < 15 * 60 * 1000) {
          deferredInvites.delete(k);
          return { found: true, slug: val.slug, passcode: val.passcode };
        }
      }
    }

    return { found: false };
  });

  // Validate face on an uploaded image without saving or changing anything
  fastify.post('/api/gallery/public/validate-face', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No image uploaded' });
    
    let tempPath = null;
    try {
      const buffer = await data.toBuffer();
      const tempDir = path.join(__dirname, '..', '..', 'uploads', 'temp');
      fs.mkdirSync(tempDir, { recursive: true });
      tempPath = path.join(tempDir, `val_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`);
      fs.writeFileSync(tempPath, buffer);
      
      const res = await faceRecManager.validateSelfie(tempPath);
      
      if (res.success && res.vector) {
        return { success: true };
      } else {
        return reply.code(400).send({ error: res.error || 'Failed to validate face on selfie' });
      }
    } catch (err) {
      req.log.error('Face validation failed: ' + err.message);
      return reply.code(400).send({ error: err.message || 'Failed to run facial verification' });
    } finally {
      if (tempPath && fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
    }
  });

  // Resolve invite code to gallery event slug & access level
  fastify.get('/api/gallery/public/lookup-code/:code', async (req, reply) => {
    const inputCode = req.params.code.trim().toUpperCase();
    if (inputCode.length !== 6) {
      return reply.code(400).send({ error: 'Invite code must be exactly 6 characters' });
    }

    try {
      const event = await prisma.galleryEvent.findFirst({
        where: {
          OR: [
            { fullCode: inputCode },
            { partialCode: inputCode }
          ]
        },
        select: {
          slug: true,
          title: true,
          fullCode: true,
          partialCode: true
        }
      });

      if (!event) {
        return reply.code(404).send({ error: 'Invalid invite code. Event not found.' });
      }

      return {
        slug: event.slug,
        title: event.title,
        accessLevel: event.fullCode === inputCode ? 'full' : 'partial'
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to lookup invite code' });
    }
  });

  // Load public details of the event
  fastify.get('/api/gallery/public/events/:slug', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    try {
      const event = await prisma.galleryEvent.findUnique({
        where: { slug },
        select: {
          id: true,
          title: true,
          date: true,
          coverPhotoUrl: true,
          coverPhotoMobileUrl: true,
          coverPhotoSquareUrl: true,
          active: true,
          tabs: true,
          allowDownloads: true,
          allowBulkDownloads: true,
          projectId: true,
          leadId: true,
          fullCode: true,
          partialCode: true
        }
      });

      const isPreview = checkPreviewToken(fastify, req);
      if (!event || (!event.active && !isPreview)) {
        return reply.code(404).send({ error: 'Gallery not found or inactive' });
      }

      const hasPasscode = !!(event.fullCode || event.partialCode);
      event.hasPasscode = hasPasscode;
      
      delete event.fullCode;
      delete event.partialCode;
      event.isPreviewMode = !!isPreview;

      const activePhotoTabs = await prisma.photo.groupBy({
        by: ['tabName'],
        where: { 
          eventId: event.id, 
          tabName: { not: null } 
        },
        _count: {
          _all: true
        }
      });
      const activeTabNames = activePhotoTabs
        .filter(t => t.tabName)
        .map(t => t.tabName.trim().toUpperCase());
      const tabCounts = {};
      activePhotoTabs.forEach(t => {
        if (t.tabName) {
          tabCounts[t.tabName.trim().toUpperCase()] = t._count._all;
        }
      });

      const totalAllCount = await prisma.photo.count({ where: { eventId: event.id } });
      tabCounts['ALL'] = totalAllCount;

      event.tabs = (event.tabs || []).filter(tab => typeof tab === 'string' && activeTabNames.includes(tab.trim().toUpperCase()));
      event.tabCounts = tabCounts;

      return event;
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Server error retrieving event details' });
    }
  });

  // Consolidated Gallery Bundle: Validates guest auth & returns event details, profile,
  // authorized photos, and tabs in a SINGLE high-speed network round-trip.
  fastify.post('/api/gallery/public/events/:slug/bundle', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const { code } = req.body || {};
    try {
      const isPreview = checkPreviewToken(fastify, req);
      const event = await prisma.galleryEvent.findUnique({
        where: { slug },
        select: {
          id: true,
          title: true,
          date: true,
          coverPhotoUrl: true,
          coverPhotoMobileUrl: true,
          coverPhotoSquareUrl: true,
          active: true,
          tabs: true,
          allowDownloads: true,
          allowBulkDownloads: true,
          fullCode: true,
          partialCode: true,
        }
      });

      if (!event || (!event.active && !isPreview)) {
        return reply.code(404).send({ error: 'Gallery not found or inactive' });
      }

      if (event.allowDownloads === false && !isPreview) {
        let isAdmin = false;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          try {
            const rawToken = authHeader.split(' ')[1];
            const decoded = fastify.jwt.verify(rawToken);
            if (decoded.role === 'admin' || (decoded.roles && decoded.roles.includes('admin'))) {
              isAdmin = true;
            }
          } catch (_) {}
        }
        if (!isAdmin && !isMobileAppRequest(req)) {
          return reply.code(403).send({
            error: 'This gallery has download protection enabled and can only be viewed in the Misty Visuals mobile app.',
            code: 'APP_ONLY_GALLERY'
          });
        }
      }

      let guestId = null;
      let hasFullAccess = !!isPreview;
      let isBrideOrGroom = false;
      let resolvedDisplayRole = null;
      let dbGuest = null;
      let circleUser = null;
      let refreshPayload = null;
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const rawToken = authHeader.split(' ')[1];
          const decoded = fastify.jwt.verify(rawToken);

          if (decoded.role === 'admin' || (decoded.roles && decoded.roles.includes('admin'))) {
            hasFullAccess = true;
          } else if (decoded.isAdminPreview && decoded.slug && decoded.slug.toLowerCase().trim() === slug) {
            hasFullAccess = true;
            let adminGuest = await prisma.guest.findFirst({
              where: { eventId: event.id, email: 'admin@mistyvisuals.com' }
            });
            if (!adminGuest) {
              adminGuest = await prisma.guest.create({
                data: {
                  eventId: event.id,
                  email: 'admin@mistyvisuals.com',
                  name: 'Admin Preview',
                  provider: 'system',
                  providerId: 'admin-preview',
                  hasFullAccess: true
                }
              });
            }
            dbGuest = adminGuest;
            guestId = adminGuest.id;
          } else if (decoded.role === 'guest') {
            const eventIdMatches = decoded.eventId != null && String(decoded.eventId) === String(event.id);
            const slugMatches = decoded.slug && decoded.slug.toLowerCase().trim() === slug;

            if (eventIdMatches || slugMatches) {
              guestId = decoded.guestId;
            } else if (decoded.guestId) {
              const fallbackGuest = await prisma.guest.findFirst({
                where: { id: decoded.guestId, eventId: event.id }
              });
              if (fallbackGuest) guestId = decoded.guestId;
            }

            if (guestId) {
              dbGuest = await prisma.guest.findUnique({
                where: { id: guestId },
                include: { circleUser: true }
              });

              if (!dbGuest) {
                return reply.code(403).send({ error: 'Participant removed from gallery', code: 'ACCESS_REVOKED' });
              }
              if (dbGuest.isBlocked) {
                return reply.code(403).send({ error: 'Participant is blocked', code: 'ACCESS_BLOCKED' });
              }

              // Check passcode upgrade if user entered a fullCode
              if (code && event.fullCode && code.trim().toUpperCase() === event.fullCode.trim().toUpperCase() && !dbGuest.hasFullAccess) {
                dbGuest = await prisma.guest.update({
                  where: { id: dbGuest.id },
                  data: { hasFullAccess: true },
                  include: { circleUser: true }
                });
              }

              hasFullAccess = dbGuest.hasFullAccess;
              resolvedDisplayRole = (dbGuest.displayRole || '').toString().trim().toUpperCase() || 'GUEST';
              isBrideOrGroom = ['BRIDE', 'GROOM', 'COUPLE'].includes(resolvedDisplayRole);
              circleUser = dbGuest.circleUser;

              // Reactivate if marked LEFT
              if (dbGuest.status === 'LEFT') {
                await prisma.$executeRaw`UPDATE guests SET status = 'ACTIVE', updated_at = NOW() WHERE id = ${dbGuest.id}`;
              }
            } else {
              return reply.code(403).send({ error: 'Token does not match this event', code: 'INVALID_EVENT' });
            }
          } else if (decoded.role === 'family' && decoded.email) {
            // Family SSO token exchange inside bundle call
            const email = decoded.email.trim().toLowerCase();
            circleUser = await prisma.circleUser.findUnique({ where: { email } });
            dbGuest = await prisma.guest.findFirst({
              where: { eventId: event.id, email },
              include: { circleUser: true }
            });

            const dbPasscode = event.fullCode;
            const dbPartialPasscode = event.partialCode;
            let isCodeValid = false;

            if (dbPasscode || dbPartialPasscode) {
              if (!code) {
                if (!dbGuest) {
                  return reply.code(400).send({ error: 'Passcode is required to access this gallery', code: 'PASSCODE_REQUIRED' });
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
                  return reply.code(400).send({ error: 'Invalid passcode', code: 'INVALID_PASSCODE' });
                }
              }
            }

            if (!dbGuest) {
              const userName = circleUser ? circleUser.name : 'Guest';
              const userPhone = circleUser ? circleUser.phoneNumber : null;
              dbGuest = await prisma.guest.create({
                data: {
                  eventId: event.id,
                  email,
                  name: userName,
                  phoneNumber: userPhone,
                  provider: circleUser?.provider || 'circle',
                  providerId: circleUser?.providerId || 'circle',
                  hasFullAccess: isCodeValid
                },
                include: { circleUser: true }
              });
            } else {
              if (dbGuest.isBlocked) {
                return reply.code(403).send({ error: 'Participant is blocked', code: 'ACCESS_BLOCKED' });
              }
              if (isCodeValid && !dbGuest.hasFullAccess) {
                dbGuest = await prisma.guest.update({
                  where: { id: dbGuest.id },
                  data: { hasFullAccess: true },
                  include: { circleUser: true }
                });
              }
              if (dbGuest.status === 'LEFT') {
                await prisma.$executeRaw`UPDATE guests SET status = 'ACTIVE', updated_at = NOW() WHERE id = ${dbGuest.id}`;
              }
            }

            guestId = dbGuest.id;
            hasFullAccess = dbGuest.hasFullAccess;
            resolvedDisplayRole = (dbGuest.displayRole || '').toString().trim().toUpperCase() || 'GUEST';
            isBrideOrGroom = ['BRIDE', 'GROOM', 'COUPLE'].includes(resolvedDisplayRole);
          }
        } catch (err) {
          return reply.code(401).send({ error: 'Session expired or invalid', code: 'TOKEN_EXPIRED' });
        }
      } else {
        return reply.code(401).send({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
      }

      // Generate refreshed guest JWT token
      if (dbGuest) {
        refreshPayload = {
          guestId: dbGuest.id,
          userId: circleUser?.id || dbGuest.id,
          eventId: event.id,
          email: dbGuest.email,
          role: 'guest',
          displayRole: resolvedDisplayRole,
          hasFullAccess: hasFullAccess
        };
      }
      const sessionToken = refreshPayload ? fastify.jwt.sign(refreshPayload, { expiresIn: '365d' }) : null;

      // Event details processing
      const hasPasscode = !!(event.fullCode || event.partialCode);
      delete event.fullCode;
      delete event.partialCode;

      // Calculate tab counts & tabs
      const activePhotoTabs = await prisma.photo.groupBy({
        by: ['tabName'],
        where: { eventId: event.id, tabName: { not: null } },
        _count: { _all: true }
      });
      const activeTabNames = activePhotoTabs
        .filter(t => t.tabName)
        .map(t => t.tabName.trim().toUpperCase());
      const tabCounts = {};
      activePhotoTabs.forEach(t => {
        if (t.tabName) tabCounts[t.tabName.trim().toUpperCase()] = t._count._all;
      });

      // Filter ceremony tabs according to full vs partial access
      let allowedTabs = (event.tabs || []).filter(tab => typeof tab === 'string' && activeTabNames.includes(tab.trim().toUpperCase()));
      if (!hasFullAccess) {
        allowedTabs = allowedTabs.filter(tab => ['HIGHLIGHTS', 'CINEMA'].includes(tab.trim().toUpperCase()));
      }
      event.tabs = allowedTabs;

      // Fetch first page of photos with strict full vs partial access controls:
      const whereClause = {
        eventId: event.id,
        ...(!isBrideOrGroom ? { isPrivate: false } : {}),
      };

      if (!hasFullAccess) {
        let actualTab = 'Highlights';
        if (event.tabs && Array.isArray(event.tabs)) {
          const matchedTab = event.tabs.find(t => t.trim().toLowerCase() === 'highlights');
          if (matchedTab) actualTab = matchedTab;
        }
        whereClause.tabName = { equals: actualTab, mode: 'insensitive' };
      } else {
        const activeTabs = event.tabs || [];
        if (activeTabs.length > 0) {
          whereClause.OR = [
            { tabName: { in: activeTabs } },
            { tabName: null }
          ];
        }
      }

      const totalAllCount = await prisma.photo.count({ where: whereClause });
      if (hasFullAccess) {
        tabCounts['ALL'] = totalAllCount;
      }
      event.tabCounts = tabCounts;

      const selectClause = {
        id: true,
        r2Url: true,
        thumbnailUrl: true,
        filename: true,
        originalFileSize: true,
        tabName: true,
        createdAt: true,
        capturedAt: true,
        width: true,
        height: true,
        isPrivate: true,
        exif: true,
        _count: { select: { likes: true } }
      };

      if (guestId) {
        selectClause.likes = {
          where: { guestId },
          select: { id: true }
        };
      }

      // Parallel data fetching: photos, favorites, cinema in single execution
      const [photos, favorites, cinemaPhotos] = await Promise.all([
        prisma.photo.findMany({
          where: whereClause,
          select: selectClause,
          orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
          take: 60
        }),
        guestId ? prisma.photoLike.findMany({
          where: { guestId, photo: { eventId: event.id } },
          include: {
            photo: {
              select: selectClause
            }
          },
          orderBy: { createdAt: 'desc' }
        }) : Promise.resolve([]),
        prisma.photo.findMany({
          where: {
            eventId: event.id,
            tabName: { in: ['Cinema', 'CINEMA', 'cinema'] },
            ...(!isBrideOrGroom ? { isPrivate: false } : {}),
          },
          select: selectClause,
          orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
          take: 60
        })
      ]);

      const formatPhoto = (p) => {
        const isVideoExt = ['.mp4', '.mov', '.m4v', '.webm'].some(ext => (p.filename || p.r2Url || '').toLowerCase().includes(ext));
        const isCinemaTab = String(p.tabName || '').trim().toUpperCase() === 'CINEMA';
        const isPhotoOnlyCinema = isCinemaTab && !isVideoExt;
        const isComingSoon = Boolean(p.exif?.isComingSoon || p.exif?.comingSoon || isPhotoOnlyCinema);

        return {
          id: p.id,
          r2Url: p.r2Url,
          thumbnailUrl: getDerivedThumbnail(p.thumbnailUrl, p.r2Url),
          filename: p.filename,
          originalSize: p.originalFileSize,
          tabName: p.tabName,
          createdAt: p.createdAt,
          capturedAt: p.capturedAt,
          width: p.width,
          height: p.height,
          likeCount: p._count?.likes || 0,
          isLiked: guestId ? (p.likes && p.likes.length > 0) : false,
          isPrivate: isBrideOrGroom ? (p.isPrivate || false) : undefined,
          isFeatured: Boolean(p.exif && p.exif.isFeatured),
          hasBakedCover: Boolean(p.exif && (p.exif.hasBakedCover || p.exif.isCoverBaked)),
          isCoverBaked: Boolean(p.exif && (p.exif.hasBakedCover || p.exif.isCoverBaked)),
          isComingSoon,
          isVideo: isVideoExt,
          title: p.exif?.title || null,
          subtitle: p.exif?.subtitle || (isComingSoon ? 'COMING SOON • TEASER POSTER' : null),
          description: p.exif?.description || null,
          cinemaCategory: p.exif?.cinemaCategory || null,
          sortOrder: typeof p.exif?.sortOrder === 'number' ? p.exif.sortOrder : 0,
          exif: p.exif || null
        };
      };

      const mappedPhotos = photos.map(formatPhoto);
      const mappedFavorites = favorites.map(f => formatPhoto(f.photo));
      const mappedCinema = cinemaPhotos.map(formatPhoto);

      // Check matched photos if guest has selfie
      let matchedPhotosList = [];
      const hasSelfie = Boolean(circleUser?.selfieUrl || dbGuest?.selfieUrl);
      if (hasSelfie && circleUser?.selfieVector && !qdrant.isMock) {
        try {
          const vectorMatches = await qdrant.searchVectors(event.id, circleUser.selfieVector, 100, 0.40);
          if (vectorMatches && vectorMatches.length > 0) {
            const photoIds = vectorMatches.map(m => m.photo_id);
            const rawMatched = await prisma.photo.findMany({
              where: { id: { in: photoIds }, eventId: event.id, ...(!isBrideOrGroom ? { isPrivate: false } : {}) },
              select: selectClause
            });
            matchedPhotosList = rawMatched.map(formatPhoto);
          }
        } catch (_) {}
      }

      return {
        success: true,
        token: sessionToken,
        event,
        guest: dbGuest ? {
          id: dbGuest.id,
          name: dbGuest.name,
          email: dbGuest.email,
          phoneNumber: dbGuest.phoneNumber,
          hasFullAccess,
          displayRole: resolvedDisplayRole,
          hasSelfie,
          selfieUrl: circleUser?.selfieUrl || null
        } : null,
        photos: mappedPhotos,
        total: totalAllCount,
        hasMore: photos.length < totalAllCount,
        matched: matchedPhotosList,
        favorites: mappedFavorites,
        cinema: mappedCinema,
        tabCache: {
          ...(mappedFavorites.length > 0 ? { 'MY FAVOURITES': mappedFavorites } : {}),
          ...(mappedCinema.length > 0 ? { 'CINEMA': mappedCinema } : {}),
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to load gallery bundle' });
    }
  });

  // Load photos of the event (requires guest auth OR admin auth)
  fastify.get('/api/gallery/public/events/:slug/photos', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    try {
      const isPreview = checkPreviewToken(fastify, req);
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event || (!event.active && !isPreview)) {
        return reply.code(404).send({ error: 'Gallery not found' });
      }

      if (event.allowDownloads === false && !isPreview) {
        let isAdmin = false;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          try {
            const token = authHeader.split(' ')[1];
            const decoded = fastify.jwt.verify(token);
            if (decoded.role === 'admin' || (decoded.roles && decoded.roles.includes('admin'))) {
              isAdmin = true;
            }
          } catch (_) {}
        }
        if (!isAdmin && !isMobileAppRequest(req)) {
          return reply.code(403).send({
            error: 'This gallery has download protection enabled and can only be viewed in the Misty Visuals mobile app.',
            code: 'APP_ONLY_GALLERY'
          });
        }
      }

      let guestId = null;
      let hasFullAccess = !!isPreview;
      let isBrideOrGroom = false;
      let refreshPayload = null; // Fix 3: populated on successful guest auth to silently rotate stale tokens
      const authHeader = req.headers.authorization;
      let isTokenValid = false;


      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          const decoded = fastify.jwt.verify(token);
          isTokenValid = true;

          if (decoded.role === 'admin' || (decoded.roles && decoded.roles.includes('admin'))) {
            hasFullAccess = true;
          } else if (decoded.isAdminPreview && decoded.slug.toLowerCase().trim() === slug) {
            hasFullAccess = true;
            let adminGuest = await prisma.guest.findFirst({
              where: { eventId: event.id, email: 'admin@mistyvisuals.com' }
            });
            if (!adminGuest) {
              adminGuest = await prisma.guest.create({
                data: {
                  eventId: event.id,
                  email: 'admin@mistyvisuals.com',
                  name: 'Admin Preview',
                  provider: 'system',
                  providerId: 'admin-preview',
                  hasFullAccess: true
                }
              });
            }
            guestId = adminGuest.id;
          } else if (decoded.role === 'guest') {
            // Fix 1: Use String() comparison to handle older tokens where eventId may be stored as a string
            const eventIdMatches = decoded.eventId != null && String(decoded.eventId) === String(event.id);
            const slugMatches = decoded.slug && decoded.slug.toLowerCase().trim() === slug;

            if (eventIdMatches || slugMatches) {
              guestId = decoded.guestId;
            } else if (decoded.guestId) {
              // Fix 2: Fallback DB lookup — if token's eventId/slug don't match (stale token),
              // check if the guest actually belongs to this event by their guestId.
              // This fixes existing users who logged in before a token format change
              // and can't see gallery photos without logging out.
              const fallbackGuest = await prisma.guest.findFirst({
                where: { id: decoded.guestId, eventId: event.id }
              });
              if (fallbackGuest) {
                guestId = decoded.guestId;
              }
            }

            if (guestId) {
              const dbGuest = await prisma.guest.findUnique({
                where: { id: guestId }
              });
              if (!dbGuest) {
                return reply.code(403).send({ error: 'Access denied: Participant removed from gallery' });
              }
              if (dbGuest.isBlocked) {
                return reply.code(403).send({ error: 'Access denied: Participant is blocked' });
              }
              hasFullAccess = dbGuest.hasFullAccess;
              const guestRole = (dbGuest.displayRole || '').toString().trim().toUpperCase();
              isBrideOrGroom = ['BRIDE', 'GROOM', 'COUPLE'].includes(guestRole);
              // Fix 3: Capture payload to silently re-mint a fresh token in the response header
              refreshPayload = {
                guestId: dbGuest.id,
                userId: decoded.userId || 0,
                eventId: event.id,
                email: dbGuest.email,
                role: 'guest',
                displayRole: dbGuest.displayRole || null,
                hasFullAccess: dbGuest.hasFullAccess
              };
            } else {
              return reply.code(403).send({ error: 'Token does not match this event' });
            }
          } else if (decoded.role === 'family' && decoded.email) {
            let familyGuest = await prisma.guest.findFirst({
              where: { eventId: event.id, email: decoded.email }
            });
            if (familyGuest) {
              if (familyGuest.isBlocked) {
                return reply.code(403).send({ error: 'Access denied: Participant is blocked' });
              }
              hasFullAccess = familyGuest.hasFullAccess;
            } else {
              hasFullAccess = !event.fullCode && !event.partialCode;
            }
          } else {
            return reply.code(403).send({ error: 'Token does not match this event' });
          }
        } catch (err) {
          // If a guest token was provided but is expired or invalid, return 401.
          // The mobile app's API interceptor catches 401 and auto-logs the user out cleanly.
          // Only fall through to admin check if NO token was sent at all.
          const hadToken = !!(authHeader && authHeader.startsWith('Bearer '));
          if (hadToken) {
            return reply.code(401).send({ error: 'Session expired', code: 'TOKEN_EXPIRED' });
          }
          isTokenValid = false;
        }
      }

      if (!isTokenValid) {
        const adminAuth = requireAdmin(req, reply);
        if (!adminAuth) return;
        hasFullAccess = true;
      }

      const offset = Math.max(0, parseInt(req.query.offset) || 0);
      const limit  = Math.min(50000, Math.max(1, parseInt(req.query.limit) || 30));
      const tabFilter = (req.query.tab || '').trim();

      const whereClause = { eventId: event.id };

      // Non-couple users never see private photos — enforced server-side
      if (!isBrideOrGroom) {
        whereClause.isPrivate = false;
      }

      if (!hasFullAccess) {
        if (tabFilter && tabFilter.trim().toLowerCase() === 'cinema') {
          let actualTab = 'Cinema';
          if (event.tabs && Array.isArray(event.tabs)) {
            const matchedTab = event.tabs.find(t => t.trim().toLowerCase() === 'cinema');
            if (matchedTab) actualTab = matchedTab;
          }
          whereClause.tabName = { equals: actualTab, mode: 'insensitive' };
        } else {
          let actualTab = 'Highlights';
          if (event.tabs && Array.isArray(event.tabs)) {
            const matchedTab = event.tabs.find(t => t.trim().toLowerCase() === 'highlights');
            if (matchedTab) actualTab = matchedTab;
          }
          whereClause.tabName = { equals: actualTab, mode: 'insensitive' };
        }
      } else {
        const activeTabs = event.tabs || [];
        if (activeTabs.length > 0) {
          whereClause.OR = [
            { tabName: { in: activeTabs } },
            { tabName: null }
          ];
        }
        if (tabFilter) {
          delete whereClause.OR;
          let actualTab = tabFilter;
          if (event.tabs && Array.isArray(event.tabs)) {
            const matchedTab = event.tabs.find(t => t.trim().toLowerCase() === tabFilter.toLowerCase());
            if (matchedTab) {
              actualTab = matchedTab;
            }
          }
          whereClause.tabName = { equals: actualTab, mode: 'insensitive' };
        }
      }

      const selectClause = {
        id: true,
        r2Url: true,
        thumbnailUrl: true,
        filename: true,
        originalFileSize: true,
        tabName: true,
        createdAt: true,
        capturedAt: true,
        width: true,
        height: true,
        isPrivate: true,
        exif: true,
        _count: {
          select: {
            likes: true
          }
        }
      };

      if (guestId) {
        selectClause.likes = {
          where: { guestId },
          select: { id: true }
        };
      }

      const [total, photos] = await Promise.all([
        prisma.photo.count({ where: whereClause }),
        prisma.photo.findMany({
          where: whereClause,
          select: selectClause,
          orderBy: [
            { capturedAt: 'asc' },
            { id: 'asc' }
          ],
          skip: offset,
          take: limit
        })
      ]);

      const mappedPhotos = photos.map(p => {
        const isVideoExt = ['.mp4', '.mov', '.m4v', '.webm'].some(ext => (p.filename || p.r2Url || '').toLowerCase().includes(ext));
        const isCinemaTab = String(p.tabName || '').trim().toUpperCase() === 'CINEMA';
        const isPhotoOnlyCinema = isCinemaTab && !isVideoExt;
        const isComingSoon = Boolean(p.exif?.isComingSoon || p.exif?.comingSoon || isPhotoOnlyCinema);

        return {
          id: p.id,
          r2Url: p.r2Url,
          thumbnailUrl: getDerivedThumbnail(p.thumbnailUrl, p.r2Url),
          filename: p.filename,
          originalSize: p.originalFileSize,
          tabName: p.tabName,
          createdAt: p.createdAt,
          capturedAt: p.capturedAt,
          width: p.width,
          height: p.height,
          likeCount: p._count?.likes || 0,
          isLiked: guestId ? (p.likes && p.likes.length > 0) : false,
          isPrivate: isBrideOrGroom ? (p.isPrivate || false) : undefined,
          isFeatured: Boolean(p.exif && p.exif.isFeatured),
          hasBakedCover: Boolean(p.exif && (p.exif.hasBakedCover || p.exif.isCoverBaked)),
          isCoverBaked: Boolean(p.exif && (p.exif.hasBakedCover || p.exif.isCoverBaked)),
          isComingSoon,
          isVideo: isVideoExt,
          title: p.exif?.title || null,
          subtitle: p.exif?.subtitle || (isComingSoon ? 'COMING SOON • TEASER POSTER' : null),
          description: p.exif?.description || null,
          cinemaCategory: p.exif?.cinemaCategory || null,
          sortOrder: typeof p.exif?.sortOrder === 'number' ? p.exif.sortOrder : 0,
          exif: p.exif || null
        };
      });

      // Fix 3: Silently rotate the guest's token on every successful photo load.
      // Mobile reads X-Refreshed-Token and saves it, so tokens never go stale.
      if (refreshPayload) {
        try {
          const freshToken = fastify.jwt.sign(refreshPayload, { expiresIn: '365d' });
          reply.header('X-Refreshed-Token', freshToken);
        } catch (_) {}
      }

      reply.header('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
      return {
        photos: mappedPhotos,
        total,
        hasMore: offset + photos.length < total
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve gallery photos' });
    }
  });

  // Get indexed timeline filmstrip keyframes across the entire tab (for Spatial Film Loupe)
  fastify.get('/api/gallery/public/events/:slug/filmstrip', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    try {
      const isPreview = checkPreviewToken(fastify, req);
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event || (!event.active && !isPreview)) {
        return reply.code(404).send({ error: 'Gallery not found' });
      }

      if (event.allowDownloads === false && !isPreview) {
        let isAdmin = false;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          try {
            const token = authHeader.split(' ')[1];
            const decoded = fastify.jwt.verify(token);
            if (decoded.role === 'admin' || (decoded.roles && decoded.roles.includes('admin'))) {
              isAdmin = true;
            }
          } catch (_) {}
        }
        if (!isAdmin && !isMobileAppRequest(req)) {
          return reply.code(403).send({
            error: 'This gallery has download protection enabled and can only be viewed in the Misty Visuals mobile app.',
            code: 'APP_ONLY_GALLERY'
          });
        }
      }

      let guestId = null;
      let hasFullAccess = !!isPreview;
      let isBrideOrGroom = false;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          const decoded = fastify.jwt.verify(token);
          if (decoded.role === 'admin' || (decoded.roles && decoded.roles.includes('admin'))) {
            hasFullAccess = true;
          } else if (decoded.isAdminPreview && decoded.slug.toLowerCase().trim() === slug) {
            hasFullAccess = true;
          } else if (decoded.role === 'guest') {
            if (decoded.hasFullAccess === true) {
              hasFullAccess = true;
            }
            const eventIdMatches = decoded.eventId != null && String(decoded.eventId) === String(event.id);
            const slugMatches = decoded.slug && decoded.slug.toLowerCase().trim() === slug;
            if (eventIdMatches || slugMatches || decoded.guestId) {
              const dbGuest = await prisma.guest.findFirst({
                where: { id: decoded.guestId, eventId: event.id }
              });
              if (dbGuest && !dbGuest.isBlocked) {
                guestId = dbGuest.id;
                hasFullAccess = dbGuest.hasFullAccess || hasFullAccess;
                const guestRole = (dbGuest.displayRole || '').toString().trim().toUpperCase();
                isBrideOrGroom = ['BRIDE', 'GROOM', 'COUPLE'].includes(guestRole);
              }
            }
          } else if (decoded.role === 'family') {
            hasFullAccess = true;
          }
        } catch (_) {}
      }

      if (!event.fullCode && !event.partialCode) {
        hasFullAccess = true;
      }

      const tabFilter = (req.query.tab || 'ALL').trim();
      const isAllTab = tabFilter.toUpperCase() === 'ALL';

      const whereClause = {
        eventId: event.id,
        ...(!isBrideOrGroom ? { isPrivate: false } : {}),
      };

      if (!isAllTab) {
        let actualTab = tabFilter;
        if (event.tabs && Array.isArray(event.tabs)) {
          const matchedTab = event.tabs.find(t => t.trim().toLowerCase() === tabFilter.toLowerCase());
          if (matchedTab) actualTab = matchedTab;
        }
        whereClause.tabName = { equals: actualTab, mode: 'insensitive' };
      }

      const total = await prisma.photo.count({ where: whereClause });
      if (total === 0) {
        return reply.send({
          total: 0,
          step: isAllTab ? 100 : 50,
          tab: tabFilter,
          keyframes: []
        });
      }

      // Step configuration:
      // ALL tab: index every 100 photos for large albums (>=500), 50 for medium (>=200), 25 for small
      // Ceremony / event tab: index every 50 photos for large albums (>=250), 25 for medium (>=100), 15 for small
      let step;
      if (isAllTab) {
        if (total >= 500) {
          step = 100;
        } else if (total >= 200) {
          step = 50;
        } else {
          step = Math.max(15, Math.floor(total / 6));
        }
      } else {
        if (total >= 250) {
          step = 50;
        } else if (total >= 100) {
          step = 25;
        } else {
          step = Math.max(10, Math.floor(total / 6));
        }
      }
      step = Math.max(5, step);

      // Fast, lightweight query selecting only milestone fields
      const photos = await prisma.photo.findMany({
        where: whereClause,
        select: {
          id: true,
          r2Url: true,
          thumbnailUrl: true,
          tabName: true,
          capturedAt: true
        },
        orderBy: [
          { capturedAt: 'asc' },
          { id: 'asc' }
        ]
      });

      const keyframes = [];
      for (let i = 0; i < photos.length; i += step) {
        const p = photos[i];
        keyframes.push({
          index: i,
          id: p.id,
          r2Url: p.r2Url,
          thumbnailUrl: getDerivedThumbnail(p.thumbnailUrl, p.r2Url),
          tabName: p.tabName
        });
      }

      // Ensure the very last photo is always present to anchor the end of the timeline
      if (photos.length > 1 && (photos.length - 1) % step !== 0) {
        const lastP = photos[photos.length - 1];
        keyframes.push({
          index: photos.length - 1,
          id: lastP.id,
          r2Url: lastP.r2Url,
          thumbnailUrl: getDerivedThumbnail(lastP.thumbnailUrl, lastP.r2Url),
          tabName: lastP.tabName
        });
      }

      return reply.send({
        total,
        step,
        tab: tabFilter,
        keyframes
      });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve filmstrip keyframes' });
    }
  });

  // Get guest's favorite/liked photos (public guest endpoint)
  fastify.get('/api/gallery/public/events/:slug/favorites', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const guestId = req.guest.guestId;

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event) {
        return reply.code(404).send({ error: 'Gallery not found' });
      }

      if (event.allowDownloads === false && !req.guest?.isPreviewMode && !isMobileAppRequest(req)) {
        return reply.code(403).send({
          error: 'This gallery has download protection enabled and can only be viewed in the Misty Visuals mobile app.',
          code: 'APP_ONLY_GALLERY'
        });
      }

      const likes = await prisma.photoLike.findMany({
        where: { guestId },
        include: {
          photo: {
            select: {
              id: true,
              r2Url: true,
              thumbnailUrl: true,
              filename: true,
              originalFileSize: true,
              tabName: true,
              createdAt: true,
              capturedAt: true,
              width: true,
              height: true,
              _count: {
                select: {
                  likes: true
                }
              }
            }
          }
        }
      });

      const validLikes = likes.filter(like => like.photo);
      const mappedPhotos = validLikes.map(like => {
        const p = like.photo;
        return {
          id: p.id,
          r2Url: p.r2Url,
          thumbnailUrl: getDerivedThumbnail(p.thumbnailUrl, p.r2Url),
          filename: p.filename,
          originalSize: p.originalFileSize,
          tabName: p.tabName,
          createdAt: p.createdAt,
          capturedAt: p.capturedAt,
          width: p.width,
          height: p.height,
          likeCount: p._count?.likes || 0,
          isLiked: true
        };
      });

      reply.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      return { photos: mappedPhotos };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve favorite photos' });
    }
  });

  // Toggle like status for a photo
  fastify.post('/api/gallery/public/events/:slug/photos/:photoId/like', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const photoId = Number(req.params.photoId);
    const guestId = req.guest.guestId;

    if (isNaN(photoId)) {
      return reply.code(400).send({ error: 'Invalid photo ID' });
    }

    try {
      const photo = await prisma.photo.findUnique({
        where: { id: photoId },
        include: { galleryEvent: true }
      });

      if (!photo || photo.galleryEvent.slug.toLowerCase().trim() !== slug) {
        return reply.code(404).send({ error: 'Photo not found in this gallery' });
      }

      const existingLike = await prisma.photoLike.findUnique({
        where: {
          photoId_guestId: {
            photoId,
            guestId
          }
        }
      });

      let liked = false;
      if (existingLike) {
        await prisma.photoLike.delete({
          where: { id: existingLike.id }
        });
        liked = false;
      } else {
        await prisma.photoLike.create({
          data: {
            photoId,
            guestId
          }
        });
        liked = true;
      }

      const likeCount = await prisma.photoLike.count({
        where: { photoId }
      });

      return { liked, likeCount };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to toggle photo like' });
    }
  });

  // Delete photo (Bride or Groom only)
  fastify.delete('/api/gallery/public/events/:slug/photos/:photoId', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const photoId = parseInt(req.params.photoId, 10);
    if (isNaN(photoId)) {
      return reply.code(400).send({ error: 'Invalid photo ID' });
    }

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event) return reply.code(404).send({ error: 'Event not found' });

      // Check if authenticated guest is Bride, Groom, or Couple
      const guestId = req.guest.guestId;
      const guest = await prisma.guest.findUnique({ where: { id: guestId } });

      let roleUpper = (guest?.displayRole || req.guest.displayRole || '').toString().trim().toUpperCase();

      if (!['BRIDE', 'GROOM', 'COUPLE'].includes(roleUpper)) {
        // Fallback candidate search
        const cleanEmail = (guest?.email || req.guest.email || '').trim().toLowerCase();
        const cleanPhone = (guest?.phoneNumber || '').replace(/\D/g, '');
        const cleanName = (guest?.name || '').trim().toLowerCase();

        const candidateGuests = await prisma.guest.findMany({
          where: { eventId: event.id, displayRole: { in: ['BRIDE', 'GROOM', 'COUPLE'] } }
        });

        const found = candidateGuests.find(g => {
          const cgEmail = (g.email || '').trim().toLowerCase();
          const cgPhone = (g.phoneNumber || '').replace(/\D/g, '');

          if (cleanEmail && cgEmail && cleanEmail === cgEmail) return true;
          if (cleanPhone && cgPhone && cleanPhone.length >= 10 && cgPhone.length >= 10 && cleanPhone === cgPhone) return true;
          return false;
        });

        if (found) {
          roleUpper = found.displayRole.trim().toUpperCase();
        }
      }

      if (!['BRIDE', 'GROOM', 'COUPLE'].includes(roleUpper)) {
        return reply.code(403).send({ error: 'Only Bride or Groom can delete photos' });
      }

      const photo = await prisma.photo.findUnique({ where: { id: photoId } });
      if (!photo || photo.eventId !== event.id) {
        return reply.code(404).send({ error: 'Photo not found in this event' });
      }

      await prisma.photo.delete({ where: { id: photoId } });

      const { deletePhotosAssets } = require('./galleryHelpers');
      deletePhotosAssets([photo], slug, req.log).catch(err => {
        req.log.error(`[deletePhotosAssets] Cleanup error for photo ${photoId}:`, err);
      });

      return { success: true, message: 'Photo deleted successfully' };
    } catch (err) {
      req.log.error('Delete photo failed:', err);
      return reply.code(500).send({ error: 'Failed to delete photo' });
    }
  });

  // Toggle photo privacy — Bride & Groom only
  fastify.patch('/api/gallery/public/events/:slug/photos/:photoId/privacy', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const photoId = parseInt(req.params.photoId, 10);
    if (isNaN(photoId)) {
      return reply.code(400).send({ error: 'Invalid photo ID' });
    }

    const { isPrivate } = req.body;
    if (typeof isPrivate !== 'boolean') {
      return reply.code(400).send({ error: 'isPrivate (boolean) is required in the request body' });
    }

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event) return reply.code(404).send({ error: 'Event not found' });

      // Resolve Bride/Groom role (same robust pattern as delete endpoint)
      const guestId = req.guest.guestId;
      const guest = await prisma.guest.findUnique({ where: { id: guestId } });

      let roleUpper = (guest?.displayRole || req.guest.displayRole || '').toString().trim().toUpperCase();

      if (!['BRIDE', 'GROOM', 'COUPLE'].includes(roleUpper)) {
        const cleanEmail = (guest?.email || req.guest.email || '').trim().toLowerCase();
        const cleanPhone = (guest?.phoneNumber || '').replace(/\D/g, '');
        const cleanName = (guest?.name || '').trim().toLowerCase();

        const candidateGuests = await prisma.guest.findMany({
          where: { eventId: event.id, displayRole: { in: ['BRIDE', 'GROOM', 'COUPLE'] } }
        });

        const found = candidateGuests.find(g => {
          const cgEmail = (g.email || '').trim().toLowerCase();
          const cgPhone = (g.phoneNumber || '').replace(/\D/g, '');

          if (cleanEmail && cgEmail && cleanEmail === cgEmail) return true;
          if (cleanPhone && cgPhone && cleanPhone.length >= 10 && cgPhone.length >= 10 && cleanPhone === cgPhone) return true;
          return false;
        });

        if (found) roleUpper = found.displayRole.trim().toUpperCase();
      }

      if (!['BRIDE', 'GROOM', 'COUPLE'].includes(roleUpper)) {
        return reply.code(403).send({ error: 'Only Bride or Groom can lock/unlock photos' });
      }

      const photo = await prisma.photo.findUnique({ where: { id: photoId } });
      if (!photo || photo.eventId !== event.id) {
        return reply.code(404).send({ error: 'Photo not found in this event' });
      }

      await prisma.photo.update({
        where: { id: photoId },
        data: { isPrivate }
      });

      return { success: true, photoId, isPrivate };
    } catch (err) {
      req.log.error('Toggle photo privacy failed:', err);
      return reply.code(500).send({ error: 'Failed to update photo privacy' });
    }
  });

  // Get clustered people from the event photos — ADMIN ONLY
  fastify.get('/api/gallery/public/events/:slug/people', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const slug = req.params.slug.toLowerCase().trim();
    try {
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event) return reply.code(404).send({ error: 'Event not found' });

      if (!event.clustersDirty && event.clustersCache) {
        return { people: event.clustersCache, fromCache: true };
      }

      const validPhotos = await prisma.photo.findMany({
        where: { eventId: event.id },
        select: { id: true }
      });
      const validPhotoIds = new Set(validPhotos.map(p => p.id));

      let dbVectors = [];
      if (qdrant.isMock) {
        dbVectors = qdrant.mockCache
          .filter(item => item.eventId === event.id && validPhotoIds.has(item.photoId))
          .map(item => ({
            photoId: item.photoId,
            faceId: item.faceId,
            vector: item.vector
          }));
      } else {
        const allVectors = await qdrant.getAllVectorsForEvent(event.id);
        dbVectors = allVectors.filter(item => validPhotoIds.has(item.photoId));
      }

      if (dbVectors.length === 0) {
        await prisma.galleryEvent.update({
          where: { id: event.id },
          data: { clustersCache: [], clustersDirty: false }
        });
        return { people: [] };
      }

      const res = await faceRecManager.clusterFaces(dbVectors);
      
      purgeOrphanedFacesBackground(req.log);

      if (!res.clusters) {
        await prisma.galleryEvent.update({
          where: { id: event.id },
          data: { clustersCache: [], clustersDirty: false }
        });
        return { people: [] };
      }

      const people = [];
      for (const cluster of res.clusters) {
        const photosInCluster = await prisma.photo.findMany({
          where: { id: { in: cluster.photoIds } },
          select: { r2Url: true, filename: true }
        });

        if (photosInCluster.length > 0) {
          let coverPhotoUrl = photosInCluster[0].r2Url;
          if (cluster.faceIds && cluster.faceIds.length > 0) {
            const firstFaceId = cluster.faceIds[0];
            if (photosInCluster[0].r2Url && photosInCluster[0].r2Url.startsWith('http')) {
              const urlParts = photosInCluster[0].r2Url.split('/');
              urlParts[urlParts.length - 2] = 'faces';
              urlParts[urlParts.length - 1] = encodeURIComponent(`${firstFaceId}.jpg`);
              coverPhotoUrl = urlParts.join('/');
            } else {
              coverPhotoUrl = `/api/photos/file/events/${slug}/faces/${encodeURIComponent(firstFaceId)}.jpg`;
            }
          }
          people.push({
            id: cluster.id,
            photoCount: cluster.photoCount,
            coverPhotoUrl,
            photos: photosInCluster
          });
        }
      }

      await prisma.galleryEvent.update({
        where: { id: event.id },
        data: { clustersCache: people, clustersDirty: false }
      });

      return { people };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to cluster event faces' });
    }
  });


  // Leave a celebration (WhatsApp-style status: LEFT update)
  fastify.post('/api/gallery/public/events/:slug/leave', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    try {
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event) {
        return reply.code(404).send({ error: 'Gallery not found' });
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required to leave celebration' });
      }

      let decoded = null;
      try {
        const rawToken = authHeader.split(' ')[1];
        decoded = fastify.jwt.verify(rawToken);
      } catch (_e) {
        return reply.code(401).send({ error: 'Invalid or expired session token' });
      }

      if (!decoded || (!decoded.email && !decoded.guestId && !decoded.userId)) {
        return reply.code(403).send({ error: 'Access denied: Invalid session identity' });
      }

      if (decoded.role === 'guest' && decoded.eventId && Number(decoded.eventId) !== event.id) {
        return reply.code(403).send({ error: 'Token does not match this celebration' });
      }

      const verifiedEmail = decoded.email ? decoded.email.trim().toLowerCase() : null;
      const verifiedPhone = (decoded.phone || decoded.phoneNumber) ? String(decoded.phone || decoded.phoneNumber) : null;
      const verifiedGuestId = decoded.guestId || null;

      let targetGuest = null;

      if (verifiedGuestId) {
        targetGuest = await prisma.guest.findFirst({
          where: { id: verifiedGuestId, eventId: event.id }
        });
      }

      if (!targetGuest && verifiedEmail) {
        targetGuest = await prisma.guest.findFirst({
          where: { eventId: event.id, email: verifiedEmail }
        });
      }

      if (!targetGuest && verifiedPhone) {
        targetGuest = await prisma.guest.findFirst({
          where: { eventId: event.id, phoneNumber: verifiedPhone }
        });
      }

      if (!targetGuest) {
        return reply.code(404).send({ error: 'Participant record not found in this celebration' });
      }

      const updatedCount = await prisma.$executeRaw`
        UPDATE guests SET status = 'LEFT', updated_at = NOW()
        WHERE event_id = ${event.id} AND id = ${targetGuest.id}
      `;

      req.log.info(`Leave event ${event.id}: updated guest record ${targetGuest.id} to LEFT for user (email=${verifiedEmail})`);
      return { success: true, status: 'LEFT', updated: updatedCount };
    } catch (err) {
      req.log.error('Leave celebration error: ' + err.message);
      return reply.code(500).send({ error: 'Failed to leave celebration' });
    }
  });
};
