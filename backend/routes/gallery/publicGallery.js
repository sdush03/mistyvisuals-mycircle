const fs = require('fs');
const path = require('path');
const { prisma } = require('../../prisma');
const qdrant = require('../../utils/qdrant');
const faceRecManager = require('../../utils/faceRecManager');
const { checkPreviewToken, getDerivedThumbnail, verifyGuestAuth } = require('./galleryCommon');

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

  // Load photos of the event (requires guest auth OR admin auth)
  fastify.get('/api/gallery/public/events/:slug/photos', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    try {
      const isPreview = checkPreviewToken(fastify, req);
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event || (!event.active && !isPreview)) {
        return reply.code(404).send({ error: 'Gallery not found' });
      }

      let guestId = null;
      let hasFullAccess = !!isPreview;
      let isBrideOrGroom = false;
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
          } else if (decoded.role === 'guest' && (Number(decoded.eventId) === event.id || (decoded.slug && decoded.slug.toLowerCase().trim() === slug))) {
            guestId = decoded.guestId;
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
        whereClause.tabName = 'Highlights';
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
          whereClause.tabName = actualTab;
        }
      }

      const selectClause = {
        id: true,
        r2Url: true,
        thumbnailUrl: true,
        filename: true,
        originalFileSize: true,
        tabName: true,
        capturedAt: true,
        width: true,
        height: true,
        isPrivate: true,
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
        isLiked: guestId ? (p.likes && p.likes.length > 0) : false,
        isPrivate: isBrideOrGroom ? (p.isPrivate || false) : undefined
      }));

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

  // Get guest's favorite/liked photos (public guest endpoint)
  fastify.get('/api/gallery/public/events/:slug/favorites', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const guestId = req.guest.guestId;

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event) {
        return reply.code(404).send({ error: 'Gallery not found' });
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
