const { prisma } = require('../prisma');
const { verifyGuestAuth } = require('../utils/galleryAuth');
const qdrant = require('../utils/qdrant');

module.exports = async function analyticsRoutes(fastify, opts) {
  const { requireAdmin } = opts;

  // Batch ingest analytics events from mobile/web clients
  fastify.post('/api/gallery/public/events/:slug/analytics/batch', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const { events, user } = req.body || {};

    if (!Array.isArray(events) || events.length === 0) {
      return { success: true, count: 0 };
    }

    try {
      const event = await prisma.galleryEvent.findUnique({
        where: { slug },
        select: { id: true }
      });

      if (!event) {
        return reply.code(404).send({ error: 'Gallery event not found' });
      }

      let guest = null;
      const userEmail = user?.email?.toLowerCase?.()?.trim?.();

      if (userEmail) {
        guest = await prisma.guest.findFirst({
          where: {
            eventId: event.id,
            email: userEmail
          }
        });

        if (!guest && user?.name) {
          try {
            guest = await prisma.guest.create({
              data: {
                eventId: event.id,
                email: userEmail,
                name: user.name,
                phoneNumber: user.phone || null,
                displayRole: user.displayRole || 'GUEST',
                provider: 'app',
                providerId: userEmail
              }
            });
          } catch (e) {}
        }
      }

      let impressionCount = 0;
      let downloadCount = 0;

      const recordsToInsert = events.map((e) => {
        if (e.eventType === 'IMPRESSION') impressionCount++;
        if (e.eventType === 'DOWNLOAD') downloadCount++;

        return {
          eventId: event.id,
          guestId: guest?.id || null,
          guestEmail: userEmail || guest?.email || null,
          guestName: user?.name || guest?.name || null,
          guestPhone: user?.phone || guest?.phoneNumber || null,
          eventType: e.eventType || 'IMPRESSION',
          mediaId: e.mediaId ? String(e.mediaId) : null,
          mediaType: e.mediaType || 'PHOTO',
          mediaUrl: e.mediaUrl || null,
          action: e.action || null,
          source: e.source || null,
          durationMs: typeof e.metrics?.durationMs === 'number' ? Math.round(e.metrics.durationMs) : 0,
          watchTimeSeconds: typeof e.metrics?.watchTimeSeconds === 'number' ? e.metrics.watchTimeSeconds : 0,
          totalDurationSeconds: typeof e.metrics?.totalDurationSeconds === 'number' ? e.metrics.totalDurationSeconds : 0,
          completionRatio: typeof e.metrics?.completionRatio === 'number' ? e.metrics.completionRatio : 0,
          metadata: e.metrics || {}
        };
      });

      // Update aggregate counters on Guest model if guest exists
      if (guest && (impressionCount > 0 || downloadCount > 0)) {
        await prisma.guest.update({
          where: { id: guest.id },
          data: {
            impressions: { increment: impressionCount },
            downloadCount: { increment: downloadCount }
          }
        }).catch(() => {});
      }

      // Bulk insert analytics events
      await prisma.galleryAnalyticsEvent.createMany({
        data: recordsToInsert
      });

      return { success: true, count: recordsToInsert.length };
    } catch (err) {
      req.log.error('Analytics batch ingestion error: ' + err.message);
      return reply.code(500).send({ error: 'Failed to ingest analytics batch' });
    }
  });

  // Track impressions and mark photos as discovered (legacy web client)
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

      // Query video analytics events for this event
      const videoEvents = await prisma.galleryAnalyticsEvent.findMany({
        where: { eventId, eventType: 'VIDEO_PLAYBACK' },
        select: {
          mediaId: true,
          mediaUrl: true,
          action: true,
          watchTimeSeconds: true,
          completionRatio: true,
          guestEmail: true,
          guestName: true
        }
      });

      let totalVideoPlays = 0;
      let totalWatchTimeSec = 0;
      let completedVideoCount = 0;
      const videoStatsMap = {};
      const guestVideoStatsMap = {};

      videoEvents.forEach((ve) => {
        const watchSec = Number(ve.watchTimeSeconds || 0);
        const key = ve.mediaId || ve.mediaUrl || 'Unknown Video';
        const gEmail = ve.guestEmail?.toLowerCase?.();

        if (!videoStatsMap[key]) {
          videoStatsMap[key] = {
            mediaId: key,
            mediaUrl: ve.mediaUrl || null,
            plays: 0,
            replays: 0,
            completions: 0,
            totalWatchSec: 0,
            viewerEmails: new Set()
          };
        }

        if (ve.action === 'START') {
          totalVideoPlays++;
          videoStatsMap[key].plays++;
          if (gEmail) videoStatsMap[key].viewerEmails.add(gEmail);
        } else if (ve.action === 'REPLAY') {
          videoStatsMap[key].replays++;
        } else if (ve.action === 'COMPLETE') {
          completedVideoCount++;
          videoStatsMap[key].completions++;
        }

        videoStatsMap[key].totalWatchSec += watchSec;
        totalWatchTimeSec += watchSec;

        if (gEmail) {
          if (!guestVideoStatsMap[gEmail]) {
            guestVideoStatsMap[gEmail] = {
              watchedMediaIds: new Set(),
              totalWatchTimeSec: 0
            };
          }
          if (ve.mediaId) {
            guestVideoStatsMap[gEmail].watchedMediaIds.add(ve.mediaId);
          }
          guestVideoStatsMap[gEmail].totalWatchTimeSec += watchSec;
        }
      });

      const videoPerformance = Object.values(videoStatsMap).map((v) => ({
        mediaId: v.mediaId,
        mediaUrl: v.mediaUrl,
        plays: v.plays,
        replays: v.replays,
        completions: v.completions,
        uniqueViewers: v.viewerEmails.size,
        totalWatchSec: Math.round(v.totalWatchSec)
      }));

      // Return stored matchCount immediately (updated when guests visit matched-photos).
      // Trigger background refresh for guests whose count may be stale (<=100 from old HNSW cap).
      const mappedGuests = guests.map(g => {
        const gEmail = g.email?.toLowerCase?.();
        const vStats = guestVideoStatsMap[gEmail] || { watchedMediaIds: new Set(), totalWatchTimeSec: 0 };
        return {
          id: g.id,
          name: g.name,
          email: g.email,
          phoneNumber: g.phoneNumber,
          impressions: g.impressions,
          matchCount: g.matchCount,
          downloadCount: g.downloadCount,
          videosWatched: vStats.watchedMediaIds.size,
          totalWatchTimeSec: Math.round(vStats.totalWatchTimeSec),
          selfieUrl: g.circleUser?.selfieUrl || null
        };
      });

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
          registeredUsers,
          totalVideoPlays,
          totalWatchTimeSec: Math.round(totalWatchTimeSec),
          completedVideoCount
        },
        videoPerformance,
        guests: mappedGuests
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve analytics' });
    }
  });
};
