const { prisma } = require('../prisma');
const { verifyGuestAuth } = require('../utils/galleryAuth');
const qdrant = require('../utils/qdrant');

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

      // selfieVector and selfieUrl live on circle_users only (dropped from guests)
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
            select: { id: true, selfieVector: true, selfieUrl: true }
          }
        },
        orderBy: { impressions: 'desc' }
      });

      // Return stored matchCount immediately (updated when guests visit matched-photos).
      // Trigger background refresh for guests whose count may be stale (<=100 from old HNSW cap).
      const mappedGuests = guests.map(g => ({
        id: g.id,
        name: g.name,
        email: g.email,
        phoneNumber: g.phoneNumber,
        impressions: g.impressions,
        matchCount: g.matchCount,
        downloadCount: g.downloadCount,
        selfieUrl: g.circleUser?.selfieUrl || null
      }));

      // Background: refresh stale matchCounts (old HNSW results were capped at ~100)
      setImmediate(async () => {
        for (const g of guests) {
          const vector = g.circleUser?.selfieVector;
          if (!vector || g.matchCount > 100) continue; // skip if already looks correct
          try {
            const matches = await qdrant.searchVectors(eventId, vector, 100000, 0.35);
            const liveCount = new Set(matches.map(m => m.photo_id)).size;
            if (liveCount !== g.matchCount) {
              await prisma.guest.update({
                where: { id: g.id },
                data: { matchCount: liveCount }
              }).catch(() => {});
            }
          } catch (e) { /* silent */ }
        }
      });

      return {
        summary: {
          totalImpressions,
          photosDiscovered: `${discoveredCount}/${totalPhotos}`,
          photosDownloaded: totalDownloads,
          registeredUsers
        },
        guests: mappedGuests
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve analytics' });
    }
  });
};
