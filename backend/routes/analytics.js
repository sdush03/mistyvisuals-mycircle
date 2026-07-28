const { prisma } = require('../prisma');
const { verifyGuestAuth } = require('../utils/galleryAuth');
const qdrant = require('../utils/qdrant');
const faceRecManager = require('../utils/faceRecManager');
const path = require('path');
const fs = require('fs');

module.exports = async function analyticsRoutes(fastify, opts) {
  const { requireAdmin } = opts;

  // Track impressions and mark photos as discovered
  fastify.post('/api/gallery/public/events/:slug/analytics/viewed', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const eventId = req.guest.eventId;
    const guestId = req.guest.guestId;
    const { photoIds } = req.body;

    if (!photoIds || !Array.isArray(photoIds) || photoIds.length === 0) {
      return reply.code(400).send({ error: 'Invalid or missing photoIds' });
    }

    try {
      const validPhotoIds = photoIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      if (validPhotoIds.length === 0) return { success: true };

      await prisma.$transaction([
        // Increment guest impressions by the unique batch size
        prisma.guest.update({
          where: { id: guestId },
          data: { impressions: { increment: validPhotoIds.length } }
        }),
        // Mark all these photos as discovered
        prisma.photo.updateMany({
          where: {
            id: { in: validPhotoIds },
            eventId: eventId,
            discovered: false
          },
          data: { discovered: true }
        })
      ]);

      return { success: true };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to record viewed analytics' });
    }
  });

  // Get overall and participant analytics (Admin or Admin Preview only)
  fastify.get('/api/gallery/public/events/:slug/analytics', { preHandler: verifyGuestAuth }, async (req, reply) => {
    let isAdmin = req.guest.isPreviewMode;
    if (!isAdmin) {
      const adminAuth = requireAdmin(req, reply);
      if (!adminAuth) return;
    }

    const eventId = req.guest.eventId;
    try {
      const totalPhotos = await prisma.photo.count({ where: { eventId } });
      const discoveredCount = await prisma.photo.count({ where: { eventId, discovered: true } });

      const aggregates = await prisma.guest.aggregate({
        where: { eventId },
        _sum: {
          impressions: true,
          downloadCount: true
        },
        _count: {
          id: true
        }
      });

      const totalImpressions = aggregates._sum.impressions || 0;
      const totalDownloads = aggregates._sum.downloadCount || 0;
      const registeredUsers = aggregates._count.id || 0;

      const guests = await prisma.guest.findMany({
        where: { eventId },
        select: {
          id: true,
          name: true,
          email: true,
          phoneNumber: true,
          impressions: true,
          matchCount: true,
          downloadCount: true,
          selfieVector: true,
          selfieUrl: true,
          circleUser: {
            select: { id: true, selfieVector: true, selfieUrl: true }
          }
        },
        orderBy: { impressions: 'desc' }
      });

      // Pre-fetch all Qdrant vectors for this event ONCE for sub-second speed
      const allEventFaces = await qdrant.getAllEventVectors(eventId).catch(() => []);

      const updatedGuests = await Promise.all(guests.map(async (g) => {
        let liveMatchCount = g.matchCount;
        let vector = g.selfieVector || g.circleUser?.selfieVector;
        const userId = g.circleUser?.id;

        if (typeof vector === 'string') {
          try { vector = JSON.parse(vector); } catch (e) {}
        }

        // 1. Check user_${userId}.json fallback if DB is null
        if (!vector) {
          let vecPath = userId ? path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `user_${userId}.json`) : null;
          if (vecPath && fs.existsSync(vecPath)) {
            try { vector = JSON.parse(fs.readFileSync(vecPath, 'utf8')); } catch (e) {}
          }
        }

        // 2. Check guest_${g.id}.json fallback if DB is null
        if (!vector) {
          const guestVecPath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `guest_${g.id}.json`);
          if (fs.existsSync(guestVecPath)) {
            try { vector = JSON.parse(fs.readFileSync(guestVecPath, 'utf8')); } catch (e) {}
          }
        }

        // 3. Image extraction fallback (R2 Cloud URL or Local File)
        if (!vector) {
          const selfieUrl = g.selfieUrl || g.circleUser?.selfieUrl;
          if (selfieUrl && selfieUrl.startsWith('http')) {
            try {
              const fetchRes = await fetch(selfieUrl);
              if (fetchRes.ok) {
                const arrayBuffer = await fetchRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const tempDir = path.join(__dirname, '..', 'uploads', 'photos', 'selfies');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                const tempPath = path.join(tempDir, `temp_analytics_${g.id}_${Date.now()}.jpg`);
                fs.writeFileSync(tempPath, buffer);
                const res = await faceRecManager.validateSelfie(tempPath);
                if (res && res.success && res.vector) {
                  vector = res.vector;
                  if (userId) {
                    prisma.circleUser.update({ where: { id: userId }, data: { selfieVector: vector } }).catch(() => {});
                  }
                  prisma.guest.update({ where: { id: g.id }, data: { selfieVector: vector } }).catch(() => {});
                }
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
              }
            } catch (e) {}
          }
        }

        if (!vector) {
          let imgPath = userId ? path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `user_${userId}.jpg`) : null;
          if (!imgPath || !fs.existsSync(imgPath)) {
            imgPath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `guest_${g.id}.jpg`);
          }
          if (fs.existsSync(imgPath)) {
            try {
              const res = await faceRecManager.validateSelfie(imgPath);
              if (res && res.success && res.vector) {
                vector = res.vector;
              }
            } catch (e) {}
          }
        }

        if (typeof vector === 'string') {
          try { vector = JSON.parse(vector); } catch (e) {}
        }

        if (vector && Array.isArray(vector) && allEventFaces.length > 0) {
          try {
            if (!g.selfieVector) {
              prisma.guest.update({ where: { id: g.id }, data: { selfieVector: vector } }).catch(() => {});
            }
            const matchedPhotoIds = new Set();
            for (const item of allEventFaces) {
              if (item.vector && Array.isArray(item.vector)) {
                let dotProduct = 0;
                const len = Math.min(item.vector.length, vector.length);
                for (let i = 0; i < len; i++) {
                  dotProduct += item.vector[i] * vector[i];
                }
                if (dotProduct >= 0.35) {
                  matchedPhotoIds.add(item.photoId);
                }
              }
            }
            liveMatchCount = matchedPhotoIds.size;
            if (liveMatchCount !== g.matchCount) {
              prisma.guest.update({
                where: { id: g.id },
                data: { matchCount: liveMatchCount }
              }).catch(() => {});
            }
          } catch (e) {
            req.log.warn(`Failed live vector count for guest ${g.id}: ${e.message}`);
          }
        }

        return {
          id: g.id,
          name: g.name,
          email: g.email,
          phoneNumber: g.phoneNumber,
          impressions: g.impressions,
          matchCount: liveMatchCount,
          downloadCount: g.downloadCount
        };
      }));

      return {
        summary: {
          totalImpressions,
          photosDiscovered: `${discoveredCount}/${totalPhotos}`,
          photosDownloaded: totalDownloads,
          registeredUsers
        },
        guests: updatedGuests
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve analytics' });
    }
  });
};
