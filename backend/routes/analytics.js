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

      // Mark all photos that received impressions as discovered
      const viewedPhotoIds = [];
      events.forEach((e) => {
        if (e.eventType === 'IMPRESSION' && e.mediaId && (e.mediaType === 'PHOTO' || !e.mediaType)) {
          const numId = parseInt(e.mediaId, 10);
          if (!isNaN(numId)) viewedPhotoIds.push(numId);
        }
      });
      if (viewedPhotoIds.length > 0) {
        await prisma.photo.updateMany({
          where: {
            id: { in: viewedPhotoIds },
            eventId: event.id,
            discovered: false
          },
          data: { discovered: true }
        }).catch(err => req.log.error(`[impressions] Failed to update discovered photos: ${err.message}`));
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
          provider: true,
          impressions: true,
          matchCount: true,
          downloadCount: true,
          circleUser: {
            select: { id: true, selfieVector: true, selfieUrl: true }
          }
        },
        orderBy: { impressions: 'desc' }
      });

      // Query video analytics events for this event (ordered chronologically)
      const videoEvents = await prisma.galleryAnalyticsEvent.findMany({
        where: { eventId, eventType: 'VIDEO_PLAYBACK' },
        select: {
          id: true,
          mediaId: true,
          mediaUrl: true,
          action: true,
          source: true,
          watchTimeSeconds: true,
          totalDurationSeconds: true,
          completionRatio: true,
          guestEmail: true,
          guestName: true,
          createdAt: true
        },
        orderBy: { createdAt: 'asc' }
      });

      const guestEmails = guests.map(g => g.email?.toLowerCase()?.trim()).filter(Boolean);
      const guestIds = guests.map(g => g.id).filter(Boolean);
      const circleUserIds = guests.map(g => g.circleUser?.id).filter(Boolean);
      const circleUserEmails = guests.map(g => g.circleUser?.email?.toLowerCase()?.trim()).filter(Boolean);
      const allLookupEmails = Array.from(new Set([...guestEmails, ...circleUserEmails]));

      // Fetch push tokens to identify iOS/Android mobile app users (even if notifications are toggled off)
      const pushTokens = (allLookupEmails.length > 0 || guestIds.length > 0 || circleUserIds.length > 0)
        ? await prisma.userPushToken.findMany({
            where: {
              OR: [
                ...(allLookupEmails.length > 0 ? [{ email: { in: allLookupEmails, mode: 'insensitive' } }] : []),
                ...(guestIds.length > 0 ? [{ guestId: { in: guestIds } }] : []),
                ...(circleUserIds.length > 0 ? [{ userId: { in: circleUserIds } }] : [])
              ]
            },
            select: {
              userId: true,
              guestId: true,
              email: true,
              platform: true
            }
          }).catch(() => [])
        : [];

      // Fetch distinct telemetry sources per guest to classify App vs Web interaction
      const platformSources = await prisma.galleryAnalyticsEvent.groupBy({
        by: ['guestEmail', 'source'],
        where: { eventId, guestEmail: { not: null } }
      }).catch(() => []);

      const platformSourcesById = await prisma.galleryAnalyticsEvent.groupBy({
        by: ['guestId', 'source'],
        where: { eventId, guestId: { not: null } }
      }).catch(() => []);

      const pushTokenMap = new Map();
      pushTokens.forEach(pt => {
        const normEmail = pt.email?.toLowerCase()?.trim();
        const platform = (pt.platform || 'app').toLowerCase();
        if (normEmail) {
          if (!pushTokenMap.has(normEmail)) pushTokenMap.set(normEmail, new Set());
          pushTokenMap.get(normEmail).add(platform);
        }
        if (pt.guestId) {
          const gKey = `id_${pt.guestId}`;
          if (!pushTokenMap.has(gKey)) pushTokenMap.set(gKey, new Set());
          pushTokenMap.get(gKey).add(platform);
        }
        if (pt.userId) {
          const uKey = `user_${pt.userId}`;
          if (!pushTokenMap.has(uKey)) pushTokenMap.set(uKey, new Set());
          pushTokenMap.get(uKey).add(platform);
        }
      });

      const guestSourcesMap = new Map();
      const addGuestSource = (key, src) => {
        if (!key || !src) return;
        const normKey = String(key).toLowerCase().trim();
        if (!guestSourcesMap.has(normKey)) guestSourcesMap.set(normKey, new Set());
        guestSourcesMap.get(normKey).add(String(src).toUpperCase());
      };

      platformSources.forEach(ps => addGuestSource(ps.guestEmail, ps.source));
      platformSourcesById.forEach(ps => addGuestSource(`id_${ps.guestId}`, ps.source));

      const guestPlatformMap = new Map();
      guests.forEach(g => {
        const gEmail = g.email?.toLowerCase()?.trim();
        const gIdKey = `id_${g.id}`;
        const uKey = g.circleUser?.id ? `user_${g.circleUser.id}` : null;
        const cuEmail = g.circleUser?.email?.toLowerCase()?.trim();

        const userTokens = new Set([
          ...(gEmail ? pushTokenMap.get(gEmail) || [] : []),
          ...(cuEmail ? pushTokenMap.get(cuEmail) || [] : []),
          ...(pushTokenMap.get(gIdKey) || []),
          ...(uKey ? pushTokenMap.get(uKey) || [] : [])
        ]);
        const hasPushToken = userTokens.size > 0;

        const allSources = new Set([
          ...(gEmail ? guestSourcesMap.get(gEmail) || [] : []),
          ...(cuEmail ? guestSourcesMap.get(cuEmail) || [] : []),
          ...(guestSourcesMap.get(gIdKey) || [])
        ]);

        let hasAppEvent = false;
        let hasWebEvent = false;
        allSources.forEach(src => {
          if (src.startsWith('WEB') || src.startsWith('DESKTOP') || src.startsWith('PORTAL')) {
            hasWebEvent = true;
          } else {
            hasAppEvent = true;
          }
        });

        const isApp = hasPushToken || hasAppEvent || (g.provider === 'app' && (g.impressions > 0 || g.downloadCount > 0));
        const isWeb = hasWebEvent || (g.provider === 'web' && (g.impressions > 0 || g.downloadCount > 0));

        let platform = 'NONE';
        let platformLabel = 'Not Active Yet';
        let platformIcon = '—';
        let platformOS = 'none';

        if (isApp && isWeb) {
          platform = 'BOTH';
          platformLabel = userTokens.has('ios') ? 'iOS App & Web' : (userTokens.has('android') ? 'Android App & Web' : 'App & Web');
          platformIcon = '📱+🌐';
          platformOS = 'both';
        } else if (isApp) {
          platform = 'APP';
          if (userTokens.has('ios')) {
            platformLabel = 'iOS App';
            platformOS = 'ios';
          } else if (userTokens.has('android')) {
            platformLabel = 'Android App';
            platformOS = 'android';
          } else {
            platformLabel = 'Mobile App';
            platformOS = 'app';
          }
          platformIcon = '📱';
        } else if (isWeb) {
          platform = 'WEB';
          platformLabel = 'Web Browser';
          platformIcon = '🌐';
          platformOS = 'web';
        }

        const info = { platform, platformLabel, platformIcon, platformOS, isApp, isWeb };
        if (gEmail) guestPlatformMap.set(gEmail, info);
        if (cuEmail) guestPlatformMap.set(cuEmail, info);
        guestPlatformMap.set(gIdKey, info);
        if (uKey) guestPlatformMap.set(uKey, info);
      });

      // Fetch photos in this gallery to match titles and thumbnails
      const galleryPhotos = await prisma.photo.findMany({
        where: { eventId },
        select: {
          id: true,
          filename: true,
          r2Url: true,
          thumbnailUrl: true,
          tabName: true,
          exif: true
        }
      });
      const photoMap = new Map();
      galleryPhotos.forEach((p) => {
        photoMap.set(String(p.id), p);
        if (p.r2Url) photoMap.set(p.r2Url, p);
      });

      // Also fetch any numeric mediaIds that weren't in galleryPhotos
      const missingNumericIds = [];
      videoEvents.forEach((ve) => {
        if (ve.mediaId && /^\d+$/.test(String(ve.mediaId))) {
          const numId = parseInt(ve.mediaId, 10);
          if (!photoMap.has(String(numId)) && !missingNumericIds.includes(numId)) {
            missingNumericIds.push(numId);
          }
        }
      });
      if (missingNumericIds.length > 0) {
        try {
          const extraPhotos = await prisma.photo.findMany({
            where: { id: { in: missingNumericIds } },
            select: {
              id: true,
              filename: true,
              r2Url: true,
              thumbnailUrl: true,
              tabName: true,
              exif: true
            }
          });
          extraPhotos.forEach((p) => {
            photoMap.set(String(p.id), p);
            if (p.r2Url) photoMap.set(p.r2Url, p);
          });
        } catch (e) {
          console.warn('Failed to fetch extra photos for video analytics:', e);
        }
      }

      let totalVideoPlays = 0;
      let completedVideoCount = 0;
      const allUniqueViewers = new Set();
      const allCompletedViewers = new Set();
      const videoStatsMap = {};
      const guestVideoStatsMap = {};
      // Active sessions keyed by `${guestEmail || 'anonymous'}_${videoKey}`
      const activeSessions = new Map();

      let totalAppWatchTimeSec = 0;
      let totalWebWatchTimeSec = 0;

      videoEvents.forEach((ve) => {
        const watchSec = Number(ve.watchTimeSeconds || 0);
        const totalDurSec = Number(ve.totalDurationSeconds || 0);
        const compRatio = Number(ve.completionRatio || 0);
        const key = ve.mediaId || ve.mediaUrl || 'Unknown Video';
        const gEmail = (ve.guestEmail || 'anonymous').toLowerCase().trim();
        const gName = ve.guestName || (gEmail !== 'anonymous' ? gEmail.split('@')[0] : 'Guest');
        const sKey = `${gEmail}_${key}`;

        if (!videoStatsMap[key]) {
          videoStatsMap[key] = {
            mediaId: key,
            mediaUrl: ve.mediaUrl || null,
            durationSec: 0,
            plays: 0,
            replays: 0,
            completions: 0,
            totalWatchSec: 0,
            viewerEmails: new Set(),
            completedViewerEmails: new Set(),
            milestones: {
              start: new Set(),
              p25: new Set(),
              p50: new Set(),
              p75: new Set(),
              complete: new Set()
            },
            viewersMap: {}
          };
        }

        const vStat = videoStatsMap[key];
        if (totalDurSec > vStat.durationSec) {
          vStat.durationSec = totalDurSec;
        }

        if (gEmail && gEmail !== 'anonymous') {
          allUniqueViewers.add(gEmail);
          if (!guestVideoStatsMap[gEmail]) {
            guestVideoStatsMap[gEmail] = {
              watchedMediaIds: new Set(),
              totalWatchTimeSec: 0,
              appWatchTimeSec: 0,
              webWatchTimeSec: 0
            };
          }
        }

        if (!vStat.viewersMap[gEmail]) {
          vStat.viewersMap[gEmail] = {
            email: gEmail,
            name: gName,
            plays: 0,
            maxWatchSec: 0,
            maxDurationSec: 0,
            maxRatio: 0,
            isCompleted: false,
            lastWatchedAt: ve.createdAt
          };
        }
        const viewerProg = vStat.viewersMap[gEmail];
        if (ve.createdAt && (!viewerProg.lastWatchedAt || new Date(ve.createdAt) > new Date(viewerProg.lastWatchedAt))) {
          viewerProg.lastWatchedAt = ve.createdAt;
        }
        if (totalDurSec > viewerProg.maxDurationSec) {
          viewerProg.maxDurationSec = totalDurSec;
        }
        if (watchSec > viewerProg.maxWatchSec) {
          viewerProg.maxWatchSec = watchSec;
        }
        if (compRatio > viewerProg.maxRatio) {
          viewerProg.maxRatio = compRatio;
        }

        if (ve.action === 'START') {
          totalVideoPlays++;
          vStat.plays++;
          viewerProg.plays++;
          vStat.milestones.start.add(gEmail);
          if (gEmail && gEmail !== 'anonymous') {
            vStat.viewerEmails.add(gEmail);
            guestVideoStatsMap[gEmail].watchedMediaIds.add(key);
          }
        } else if (ve.action === 'REPLAY') {
          vStat.replays++;
          viewerProg.plays++;
          vStat.milestones.start.add(gEmail);
          if (gEmail && gEmail !== 'anonymous') {
            vStat.viewerEmails.add(gEmail);
            guestVideoStatsMap[gEmail].watchedMediaIds.add(key);
          }
        } else if (ve.action === 'COMPLETE') {
          completedVideoCount++;
          vStat.completions++;
          vStat.completedViewerEmails.add(gEmail);
          vStat.milestones.complete.add(gEmail);
          viewerProg.isCompleted = true;
          viewerProg.maxRatio = Math.max(viewerProg.maxRatio, 1.0);
          if (gEmail && gEmail !== 'anonymous') {
            allCompletedViewers.add(gEmail);
          }
        }

        // Milestone reach tracking (cascading reach)
        if (ve.action === 'MILESTONE_25' || compRatio >= 0.25) {
          vStat.milestones.start.add(gEmail);
          vStat.milestones.p25.add(gEmail);
        }
        if (ve.action === 'MILESTONE_50' || compRatio >= 0.50) {
          vStat.milestones.start.add(gEmail);
          vStat.milestones.p25.add(gEmail);
          vStat.milestones.p50.add(gEmail);
        }
        if (ve.action === 'MILESTONE_75' || compRatio >= 0.75) {
          vStat.milestones.start.add(gEmail);
          vStat.milestones.p25.add(gEmail);
          vStat.milestones.p50.add(gEmail);
          vStat.milestones.p75.add(gEmail);
        }
        if (ve.action === 'COMPLETE' || compRatio >= 0.95) {
          vStat.milestones.start.add(gEmail);
          vStat.milestones.p25.add(gEmail);
          vStat.milestones.p50.add(gEmail);
          vStat.milestones.p75.add(gEmail);
          vStat.milestones.complete.add(gEmail);
          vStat.completedViewerEmails.add(gEmail);
          viewerProg.isCompleted = true;
          if (gEmail && gEmail !== 'anonymous') {
            allCompletedViewers.add(gEmail);
          }
        }

        if (watchSec > 0 || compRatio > 0) {
          vStat.milestones.start.add(gEmail);
          if (gEmail && gEmail !== 'anonymous') {
            vStat.viewerEmails.add(gEmail);
            guestVideoStatsMap[gEmail].watchedMediaIds.add(key);
          }
        }

        // Determine whether this event/session was from Web or App
        const evSource = (ve.source || '').toUpperCase();
        let evPlatform = evSource ? (evSource.startsWith('WEB') ? 'web' : 'app') : null;
        if (!evPlatform) {
          const gp = guestPlatformMap.get(gEmail);
          evPlatform = (gp?.platform === 'APP') ? 'app' : 'web';
        }

        // Session delimited by START or REPLAY
        let curSession = activeSessions.get(sKey);
        if (ve.action === 'START' || ve.action === 'REPLAY' || !curSession) {
          if (curSession) {
            const watchAmount = curSession.maxWatch;
            vStat.totalWatchSec += watchAmount;
            if (curSession.platform === 'app') {
              totalAppWatchTimeSec += watchAmount;
            } else {
              totalWebWatchTimeSec += watchAmount;
            }
            if (gEmail && guestVideoStatsMap[gEmail]) {
              guestVideoStatsMap[gEmail].totalWatchTimeSec += watchAmount;
              if (curSession.platform === 'app') {
                guestVideoStatsMap[gEmail].appWatchTimeSec += watchAmount;
              } else {
                guestVideoStatsMap[gEmail].webWatchTimeSec += watchAmount;
              }
            }
          }
          curSession = { maxWatch: watchSec, platform: evPlatform };
          activeSessions.set(sKey, curSession);
        } else {
          curSession.maxWatch = Math.max(curSession.maxWatch, watchSec);
        }
      });

      // Commit remaining active sessions
      for (const [sKey, curSession] of activeSessions.entries()) {
        const lastUnderscore = sKey.lastIndexOf('_');
        const gEmail = sKey.substring(0, lastUnderscore);
        const key = sKey.substring(lastUnderscore + 1);
        const watchAmount = curSession.maxWatch;
        if (videoStatsMap[key]) {
          videoStatsMap[key].totalWatchSec += watchAmount;
        }
        if (curSession.platform === 'app') {
          totalAppWatchTimeSec += watchAmount;
        } else {
          totalWebWatchTimeSec += watchAmount;
        }
        if (gEmail && guestVideoStatsMap[gEmail]) {
          guestVideoStatsMap[gEmail].totalWatchTimeSec += watchAmount;
          if (curSession.platform === 'app') {
            guestVideoStatsMap[gEmail].appWatchTimeSec += watchAmount;
          } else {
            guestVideoStatsMap[gEmail].webWatchTimeSec += watchAmount;
          }
        }
      }

      let totalWatchTimeSec = 0;
      const videoPerformance = Object.values(videoStatsMap).map((v) => {
        totalWatchTimeSec += v.totalWatchSec;
        const photo = photoMap.get(String(v.mediaId)) || (v.mediaUrl ? photoMap.get(v.mediaUrl) : null);
        let rawTitle = photo?.exif?.title || photo?.filename || (v.mediaId ? `Video #${v.mediaId}` : 'Cinema Video');
        if (typeof rawTitle === 'string' && (rawTitle.startsWith('http://') || rawTitle.startsWith('https://'))) {
          try {
            const parsed = new URL(rawTitle);
            rawTitle = decodeURIComponent(parsed.pathname.split('/').pop() || rawTitle);
          } catch {}
        }
        const displayTitle = typeof rawTitle === 'string'
          ? rawTitle.replace(/\.(mp4|mov|m4v|webm)$/i, '')
          : (v.mediaId ? `Video #${v.mediaId}` : 'Cinema Video');

        const uniqueViewers = v.viewerEmails.size;
        const completedViewers = v.completedViewerEmails.size;
        const viewerCompletionRate = uniqueViewers > 0
          ? Math.round((completedViewers / uniqueViewers) * 100)
          : (v.plays > 0 && v.completions > 0 ? 100 : 0);
        const playCompletionRate = v.plays > 0
          ? Math.round((v.completions / v.plays) * 100)
          : 0;

        const baseViewers = Math.max(uniqueViewers, v.milestones.start.size, 1);
        const retention = {
          start: v.milestones.start.size,
          p25: v.milestones.p25.size,
          p50: v.milestones.p50.size,
          p75: v.milestones.p75.size,
          complete: v.milestones.complete.size,
          startPct: v.milestones.start.size > 0 ? 100 : 0,
          p25Pct: Math.round((v.milestones.p25.size / baseViewers) * 100),
          p50Pct: Math.round((v.milestones.p50.size / baseViewers) * 100),
          p75Pct: Math.round((v.milestones.p75.size / baseViewers) * 100),
          completePct: Math.round((v.milestones.complete.size / baseViewers) * 100)
        };

        return {
          mediaId: v.mediaId,
          mediaUrl: v.mediaUrl || photo?.r2Url || null,
          title: displayTitle,
          filename: photo?.filename || null,
          thumbnailUrl: photo?.thumbnailUrl || null,
          tabName: photo?.tabName || 'Cinema',
          durationSec: Math.round(v.durationSec),
          plays: v.plays,
          replays: v.replays,
          completions: v.completions,
          uniqueViewers,
          completedViewers,
          completionRate: viewerCompletionRate,
          viewerCompletionRate,
          playCompletionRate,
          totalWatchSec: Math.round(v.totalWatchSec),
          avgWatchSec: v.plays > 0 ? Math.round(v.totalWatchSec / v.plays) : 0,
          retention,
          viewers: Object.values(v.viewersMap).sort((a, b) => b.maxWatchSec - a.maxWatchSec)
        };
      });

      let appOnlyCount = 0;
      let webOnlyCount = 0;
      let bothPeopleCount = 0;

      // Return stored matchCount immediately (updated when guests visit matched-photos).
      // Trigger background refresh for guests whose count may be stale (<=100 from old HNSW cap).
      const mappedGuests = guests.map(g => {
        const gEmail = g.email?.toLowerCase()?.trim();
        const cuEmail = g.circleUser?.email?.toLowerCase()?.trim();
        const vStats = (gEmail && guestVideoStatsMap[gEmail]) || (cuEmail && guestVideoStatsMap[cuEmail]) || {
          watchedMediaIds: new Set(),
          totalWatchTimeSec: 0,
          appWatchTimeSec: 0,
          webWatchTimeSec: 0
        };
        const pInfo = (gEmail && guestPlatformMap.get(gEmail)) ||
          (cuEmail && guestPlatformMap.get(cuEmail)) ||
          guestPlatformMap.get(`id_${g.id}`) ||
          (g.circleUser?.id && guestPlatformMap.get(`user_${g.circleUser.id}`)) || {
          platform: 'NONE',
          platformLabel: 'Not Active Yet',
          platformIcon: '—',
          platformOS: 'none',
          isApp: false,
          isWeb: false
        };

        if (pInfo.platform === 'APP') {
          appOnlyCount++;
        } else if (pInfo.platform === 'WEB') {
          webOnlyCount++;
        } else if (pInfo.platform === 'BOTH') {
          bothPeopleCount++;
        }

        return {
          id: g.id,
          name: g.name,
          email: g.email,
          phoneNumber: g.phoneNumber,
          impressions: g.impressions,
          matchCount: g.matchCount,
          downloadCount: g.downloadCount,
          videosWatched: vStats.watchedMediaIds.size,
          appWatchTimeSec: Math.round(vStats.appWatchTimeSec),
          webWatchTimeSec: Math.round(vStats.webWatchTimeSec),
          totalWatchTimeSec: Math.round(vStats.totalWatchTimeSec),
          platform: pInfo.platform,
          platformLabel: pInfo.platformLabel,
          platformIcon: pInfo.platformIcon,
          platformOS: pInfo.platformOS,
          selfieUrl: g.circleUser?.selfieUrl || null
        };
      });

      const appPeopleCount = appOnlyCount + bothPeopleCount;
      const webPeopleCount = webOnlyCount + bothPeopleCount;
      const activePeopleCount = appOnlyCount + webOnlyCount + bothPeopleCount;
      const totalPeople = mappedGuests.length || registeredUsers || 0;
      const inactiveCount = Math.max(0, totalPeople - activePeopleCount);

      const denominator = activePeopleCount > 0 ? activePeopleCount : totalPeople;
      const appPeoplePercentage = denominator > 0 ? Math.round((appPeopleCount / denominator) * 100) : 0;
      const webPeoplePercentage = denominator > 0
        ? (bothPeopleCount === 0 ? (100 - appPeoplePercentage) : Math.round((webPeopleCount / denominator) * 100))
        : 0;
      const bothPeoplePercentage = denominator > 0 ? Math.round((bothPeopleCount / denominator) * 100) : 0;

      const appOnlyPercentage = denominator > 0 ? Math.round((appOnlyCount / denominator) * 100) : 0;
      const bothPercentage = bothPeoplePercentage;
      const webOnlyPercentage = denominator > 0 ? Math.max(0, 100 - appOnlyPercentage - bothPercentage) : 0;

      const totalEngagementTimeSec = totalAppWatchTimeSec + totalWebWatchTimeSec;
      const appTimePercentage = totalEngagementTimeSec > 0
        ? Math.round((totalAppWatchTimeSec / totalEngagementTimeSec) * 100)
        : 0;
      const webTimePercentage = totalEngagementTimeSec > 0
        ? (100 - appTimePercentage)
        : 0;

      let comparisonInsight = '';
      if (totalEngagementTimeSec > 0 && activePeopleCount > 0) {
        if (webPeoplePercentage >= appPeoplePercentage && appTimePercentage > webTimePercentage) {
          comparisonInsight = `${webPeoplePercentage}% of active people use Web, but ${appTimePercentage}% of time spent is on the Mobile App.`;
        } else if (appPeoplePercentage >= webPeoplePercentage && webTimePercentage > appTimePercentage) {
          comparisonInsight = `${appPeoplePercentage}% of active people use the Mobile App, but ${webTimePercentage}% of time spent is on Web.`;
        } else if (appTimePercentage >= 60) {
          comparisonInsight = `${appTimePercentage}% of engagement time happens on the Mobile App (${appPeoplePercentage}% of active participants).`;
        } else if (webTimePercentage >= 60) {
          comparisonInsight = `${webTimePercentage}% of engagement time happens on Web (${webPeoplePercentage}% of active participants).`;
        } else {
          comparisonInsight = `Audience engagement is balanced: ${appTimePercentage}% on Mobile App vs ${webTimePercentage}% on Web.`;
        }
      } else if (activePeopleCount > 0) {
        comparisonInsight = `${appPeopleCount} active on Mobile App, ${webPeopleCount} on Web (${inactiveCount} not active yet).`;
      } else {
        comparisonInsight = 'No audience platform activity recorded yet.';
      }

      const platformBreakdown = {
        people: {
          appCount: appPeopleCount,
          webCount: webPeopleCount,
          bothCount: bothPeopleCount,
          activeCount: activePeopleCount,
          inactiveCount,
          appOnlyCount,
          webOnlyCount,
          totalCount: totalPeople,
          appPercentage: appPeoplePercentage,
          webPercentage: webPeoplePercentage,
          bothPercentage: bothPeoplePercentage,
          appOnlyPercentage,
          webOnlyPercentage
        },
        timeSpent: {
          appTimeSec: Math.round(totalAppWatchTimeSec),
          webTimeSec: Math.round(totalWebWatchTimeSec),
          totalTimeSec: Math.round(totalEngagementTimeSec),
          appPercentage: appTimePercentage,
          webPercentage: webTimePercentage
        },
        insight: comparisonInsight
      };

      // NOTE: Removed legacy background vector re-scan loop (Fix #17).
      // Previously, opening the analytics dashboard quietly fired 80+ Qdrant vector scans
      // in the background as an ad-hoc backfill. Match counts are updated when photos/vectors
      // are processed or when guests view matched photos.

      const totalUniqueViewers = allUniqueViewers.size;
      const totalCompletedUniqueViewers = allCompletedViewers.size;
      const overallViewerCompletionRate = totalUniqueViewers > 0
        ? Math.round((totalCompletedUniqueViewers / totalUniqueViewers) * 100)
        : (totalVideoPlays > 0 && completedVideoCount > 0 ? 100 : 0);

      return {
        summary: {
          totalImpressions,
          photosDiscovered: `${discoveredCount}/${totalPhotos}`,
          photosDownloaded: totalDownloads,
          registeredUsers,
          totalVideoPlays,
          totalWatchTimeSec: Math.round(totalWatchTimeSec),
          completedVideoCount,
          uniqueVideoViewers: totalUniqueViewers,
          completedVideoViewers: totalCompletedUniqueViewers,
          viewerCompletionRate: overallViewerCompletionRate,
          platformBreakdown
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
