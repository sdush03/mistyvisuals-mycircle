const { prisma } = require('../prisma');
const { verifyGuestAuth } = require('../utils/galleryAuth');
const qdrant = require('../utils/qdrant');
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
          circleUser: {
            select: { id: true }
          }
        },
        orderBy: { impressions: 'desc' }
      });

      // Recalculate live matchCount from Qdrant for guests with saved selfie vectors
      const updatedGuests = await Promise.all(guests.map(async (g) => {
        let liveMatchCount = g.matchCount;
        const userId = g.circleUser?.id;
        if (userId) {
          const vectorPath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `user_${userId}.json`);
          if (fs.existsSync(vectorPath)) {
            try {
              const vector = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));
              const matches = await qdrant.searchVectors(eventId, vector, 100000, 0.35);
              liveMatchCount = new Set(matches.map(m => m.photo_id)).size;
              // Persist updated matchCount to database asynchronously
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
