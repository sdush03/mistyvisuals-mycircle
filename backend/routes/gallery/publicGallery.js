const fs = require('fs');
const path = require('path');
const { prisma } = require('../../prisma');
const faceRecManager = require('../../utils/faceRecManager');
const { checkPreviewToken, getDerivedThumbnail, verifyGuestAuth } = require('./galleryCommon');
const { generateUniqueCode } = require('./galleryHelpers');

module.exports = async function publicGalleryRoutes(fastify, opts) {
  const { requireAdmin } = opts;

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
        fs.unlinkSync(tempPath);
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
        isLiked: guestId ? (p.likes && p.likes.length > 0) : false
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
};
