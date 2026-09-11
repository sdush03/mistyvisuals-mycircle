const fs = require('fs');
const path = require('path');
const { prisma } = require('../../prisma');
const qdrant = require('../../utils/qdrant');
const { uploadAsset, deleteAsset, getPresignedUploadUrl } = require('../../utils/r2');
const { deletePhotosAssets, generateUniqueCode } = require('./galleryHelpers');

module.exports = async function adminGalleryRoutes(fastify, opts) {
  const { pool, requireAdmin } = opts;

  // Get all wedding gallery events (Admin only)
  fastify.get('/api/gallery/events', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    try {
      const events = await prisma.galleryEvent.findMany({
        where: {
          NOT: {
            slug: 'system-directory'
          }
        },
        orderBy: { date: 'desc' }
      });

      const leadIds = events.map(e => e.leadId).filter(Boolean);
      let projectsMap = {};
      if (leadIds.length > 0) {
        const projRes = await pool.query(
          `SELECT id, lead_id, slug, name FROM projects WHERE lead_id = ANY($1::int[])`,
          [leadIds]
        );
        projRes.rows.forEach(p => {
          projectsMap[p.lead_id] = {
            uuid: p.id,
            slug: p.slug,
            name: p.name
          };
        });
      }

      const enrichedEvents = events.map(e => {
        const match = projectsMap[e.leadId] || {};
        return {
          ...e,
          projectUuid: match.uuid || null,
          crmSlug: match.slug || null,
          crmName: match.name || null
        };
      });

      return { events: enrichedEvents };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve gallery events' });
    }
  });

  // Get gallery event for a specific project (Admin only — looks up by project UUID, not slug)
  fastify.get('/api/gallery/events/by-project/:projectId', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const { projectId } = req.params;
    try {
      const event = await prisma.galleryEvent.findUnique({
        where: { projectId },
        select: {
          id: true,
          slug: true,
          projectId: true,
          title: true,
          date: true,
          coverPhotoUrl: true,
          coverPhotoMobileUrl: true,
          coverPhotoSquareUrl: true,
          active: true,
          leadId: true,
          qrToken: true
        }
      });

      if (!event) {
        return reply.code(404).send({ error: 'Gallery not found for this project' });
      }

      return event;
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve gallery event' });
    }
  });

  // Get CRM project_events for a given gallery event slug (used by uploader desktop app)
  fastify.get('/api/gallery/events/:slug/project-events', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const { slug } = req.params;
    try {
      const galleryEvent = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!galleryEvent) {
        return reply.code(404).send({ error: 'Gallery event not found' });
      }

      let crmEvents = [];
      if (galleryEvent.leadId) {
        const projRes = await pool.query(
          `SELECT id FROM projects WHERE lead_id = $1 LIMIT 1`,
          [galleryEvent.leadId]
        );
        if (projRes.rows.length > 0) {
          const eventsRes = await pool.query(
            `SELECT event_type FROM project_events WHERE project_id = $1 ORDER BY event_date ASC, created_at ASC`,
            [projRes.rows[0].id]
          );
          crmEvents = [...new Set(eventsRes.rows.map(e => e.event_type).filter(Boolean))];
        }
      }

      let mergedTabs = galleryEvent.tabs || [];
      if (mergedTabs.length <= 1) {
        mergedTabs = ['Highlights', ...crmEvents.filter(e => e !== 'Highlights')];
        await prisma.galleryEvent.update({
          where: { id: galleryEvent.id },
          data: { tabs: mergedTabs }
        });
      }

      return {
        projectEvents: mergedTabs.map((tab, idx) => ({
          id: idx + 1,
          event_type: tab,
          event_date: galleryEvent.date,
          venue: '—',
          slot: '—'
        }))
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve project events' });
    }
  });

  // Create or return existing gallery event for a project
  fastify.post('/api/gallery/events', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const { slug, title, date, qrToken, coverPhotoUrl, leadId, projectId } = req.body;
    if (!slug || !title || !date) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }

    const resolvedQrToken = qrToken || `${slug.toLowerCase().trim()}_qr`;

    try {
      const fetchInitialTabs = async () => {
        let resolvedProjectId = projectId;
        if (!resolvedProjectId && leadId) {
          const projRes = await pool.query(
            `SELECT id FROM projects WHERE lead_id = $1 LIMIT 1`,
            [parseInt(leadId, 10)]
          );
          if (projRes.rows.length) {
            resolvedProjectId = projRes.rows[0].id;
          }
        }
        if (!resolvedProjectId) return [];
        const eventsRes = await pool.query(
          `SELECT event_type FROM project_events WHERE project_id = $1 ORDER BY event_date ASC, created_at ASC`,
          [resolvedProjectId]
        );
        return [...new Set(eventsRes.rows.map(e => e.event_type).filter(Boolean))];
      };

      const initialTabs = await fetchInitialTabs();
      const tabsWithHighlights = ['Highlights', ...initialTabs.filter(t => t !== 'Highlights')];

      const fullCode = await generateUniqueCode();
      let partialCode = null;
      while (true) {
        const candidate = await generateUniqueCode();
        if (candidate !== fullCode) {
          partialCode = candidate;
          break;
        }
      }

      if (projectId) {
        const event = await prisma.galleryEvent.upsert({
          where: { projectId },
          update: {
            slug: slug.toLowerCase().trim(),
            title,
            date: new Date(date),
            leadId: leadId ? parseInt(leadId, 10) : null
          },
          create: {
            slug: slug.toLowerCase().trim(),
            projectId,
            title,
            date: new Date(date),
            qrToken: resolvedQrToken,
            coverPhotoUrl: coverPhotoUrl || null,
            leadId: leadId ? parseInt(leadId, 10) : null,
            active: true,
            tabs: tabsWithHighlights,
            fullCode,
            partialCode
          }
        });
        return event;
      }

      const existing = await prisma.galleryEvent.findFirst({
        where: { OR: [{ slug: slug.toLowerCase().trim() }, { qrToken: resolvedQrToken }] }
      });
      if (existing) {
        return existing;
      }

      const event = await prisma.galleryEvent.create({
        data: {
          slug: slug.toLowerCase().trim(),
          title,
          date: new Date(date),
          qrToken: resolvedQrToken,
          coverPhotoUrl: coverPhotoUrl || null,
          leadId: leadId ? parseInt(leadId, 10) : null,
          tabs: tabsWithHighlights,
          fullCode,
          partialCode
        }
      });

      return event;
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to create gallery event' });
    }
  });

  // Add a new tab/category to a gallery event
  fastify.post('/api/gallery/events/:id/tabs', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { tabName } = req.body;

    if (!tabName) {
      return reply.code(400).send({ error: 'Missing tabName' });
    }

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.code(404).send({ error: 'Gallery event not found' });
      }

      if (event.tabs.includes(tabName)) {
        return { success: true, message: 'Tab already exists' };
      }

      const updated = await prisma.galleryEvent.update({
        where: { id: eventId },
        data: {
          tabs: {
            push: tabName
          }
        }
      });
      return { success: true, tabs: updated.tabs };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to add tab' });
    }
  });

  // Rename a category/tab name in a gallery event
  fastify.patch('/api/gallery/events/:id/tabs/rename', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { oldName, newName } = req.body;

    if (!oldName || !newName) {
      return reply.code(400).send({ error: 'Missing oldName or newName' });
    }

    if (oldName === 'Highlights') {
      return reply.code(403).send({ error: 'The "Highlights" tab cannot be renamed.' });
    }

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.code(404).send({ error: 'Gallery event not found' });
      }

      const updatedTabs = event.tabs.map(tab => tab === oldName ? newName : tab);

      await prisma.$transaction([
        prisma.galleryEvent.update({
          where: { id: eventId },
          data: { tabs: updatedTabs }
        }),
        prisma.photo.updateMany({
          where: { eventId, tabName: oldName },
          data: { tabName: newName }
        })
      ]);

      return { success: true, tabs: updatedTabs };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to rename tab' });
    }
  });

  // Delete all photos belonging to a tab in a gallery event
  fastify.delete('/api/gallery/events/:id/tabs', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { tabName } = req.body;

    if (!tabName) {
      return reply.code(400).send({ error: 'Missing tabName' });
    }

    if (tabName === 'Highlights') {
      return reply.code(403).send({ error: 'The "Highlights" tab cannot be deleted.' });
    }

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.code(404).send({ error: 'Gallery event not found' });
      }

      const updatedTabs = event.tabs.filter(tab => tab.toLowerCase() !== tabName.toLowerCase());

      const photosToDelete = await prisma.photo.findMany({
        where: {
          eventId,
          tabName: {
            equals: tabName,
            mode: 'insensitive'
          }
        }
      });

      const slug = event.slug.toLowerCase().trim();

      await prisma.$transaction([
        prisma.galleryEvent.update({
          where: { id: eventId },
          data: {
            tabs: updatedTabs,
            clustersDirty: true
          }
        }),
        prisma.photo.deleteMany({
          where: {
            eventId,
            tabName: {
              equals: tabName,
              mode: 'insensitive'
            }
          }
        })
      ]);

      if (slug) {
        deletePhotosAssets(photosToDelete, slug, req.log).catch((err) => {
          req.log.error(`[deletePhotosAssets] Non-blocking cleanup error:`, err);
        });
      }

      return { success: true, tabs: updatedTabs };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to delete tab' });
    }
  });

  // Get all photos for a gallery event (Admin only - used by desktop uploader)
  fastify.get('/api/gallery/events/:id/photos', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const limit = Math.min(parseInt(req.query.limit, 10) || 10000, 50000);
    const offset = parseInt(req.query.offset, 10) || 0;
    const tabName = req.query.tab;

    try {
      const whereClause = { eventId };
      if (tabName && tabName !== 'ALL') {
        whereClause.tabName = tabName;
      }

      const [total, photos] = await Promise.all([
        prisma.photo.count({ where: whereClause }),
        prisma.photo.findMany({
          where: whereClause,
          orderBy: [
            { capturedAt: 'asc' },
            { id: 'asc' }
          ],
          skip: offset,
          take: limit
        })
      ]);

      return {
        photos: photos.map(p => ({
          ...p,
          isFeatured: Boolean(p.exif && p.exif.isFeatured),
          hasBakedCover: Boolean(p.exif && (p.exif.hasBakedCover || p.exif.isCoverBaked)),
          isCoverBaked: Boolean(p.exif && (p.exif.hasBakedCover || p.exif.isCoverBaked))
        })),
        total,
        hasMore: offset + photos.length < total
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve event photos' });
    }
  });

  // Delete multiple photos by ID (admin only)
  fastify.delete('/api/gallery/events/:id/photos', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { photoIds } = req.body;

    if (!photoIds || !Array.isArray(photoIds) || photoIds.length === 0) {
      return reply.code(400).send({ error: 'Missing or invalid photoIds' });
    }

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
      const slug = event ? event.slug.toLowerCase().trim() : null;

      const photosToDelete = await prisma.photo.findMany({
        where: {
          id: { in: photoIds },
          eventId: eventId
        }
      });

      const deleted = await prisma.photo.deleteMany({
        where: {
          id: { in: photosToDelete.map(p => p.id) },
          eventId: eventId
        }
      });

      await prisma.galleryEvent.update({
        where: { id: eventId },
        data: { clustersDirty: true }
      });

      if (slug) {
        deletePhotosAssets(photosToDelete, slug, req.log).catch((err) => {
          req.log.error(`[deletePhotosAssets] Non-blocking cleanup error:`, err);
        });
      }

      return { success: true, count: deleted.count };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to delete photos' });
    }
  });

  // Move multiple photos to another tab (admin only)
  fastify.patch('/api/gallery/events/:id/photos/move', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { photoIds, targetTab } = req.body;

    if (!photoIds || !Array.isArray(photoIds) || photoIds.length === 0 || !targetTab) {
      return reply.code(400).send({ error: 'Missing or invalid parameters' });
    }

    try {
      const event = await prisma.galleryEvent.findUnique({
        where: { id: eventId }
      });

      if (!event) {
        return reply.code(404).send({ error: 'Gallery event not found' });
      }

      if (!event.tabs.includes(targetTab)) {
        return reply.code(400).send({ error: `Target tab '${targetTab}' does not exist in this event` });
      }

      const updated = await prisma.photo.updateMany({
        where: {
          id: { in: photoIds },
          eventId: eventId
        },
        data: {
          tabName: targetTab
        }
      });

      return { success: true, count: updated.count };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to move photos' });
    }
  });

  // Generate pre-signed R2 upload URLs for photo metadata (Admin only)
  fastify.post('/api/gallery/events/:id/generate-upload-urls', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { uploads } = req.body;

    if (!uploads || !Array.isArray(uploads)) {
      return reply.code(400).send({ error: 'Missing or invalid uploads array' });
    }

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      const slug = event.slug.toLowerCase().trim();
      const { isR2Enabled } = require('../../utils/r2');
      let publicDomain = '';
      if (isR2Enabled && process.env.R2_PUBLIC_DOMAIN_URL) {
        publicDomain = process.env.R2_PUBLIC_DOMAIN_URL.trim();
        if (publicDomain.startsWith('http://')) publicDomain = publicDomain.substring(7);
        if (publicDomain.startsWith('https://')) publicDomain = publicDomain.substring(8);
      }

      const results = [];
      for (const item of uploads) {
        const isVideoItem = ['.mp4', '.mov', '.m4v', '.webm'].some(ext => (item.filename || '').toLowerCase().endsWith(ext));
        const baseName = path.basename(item.filename, path.extname(item.filename));
        const photoKey = `events/${slug}/photos/${item.filename}`;
        const thumbFilename = isVideoItem ? `thumb_${baseName}.jpg` : `thumb_${item.filename}`;
        const thumbKey = `events/${slug}/thumbnails/${thumbFilename}`;

        const r2Url = isR2Enabled ? `https://${publicDomain}/${photoKey}` : `/api/photos/file/${photoKey}`;
        const thumbnailUrl = isR2Enabled ? `https://${publicDomain}/${thumbKey}` : `/api/photos/file/${thumbKey}`;

        const photoPutUrl = await getPresignedUploadUrl(photoKey, isVideoItem ? 'video/mp4' : 'image/jpeg');
        const thumbPutUrl = await getPresignedUploadUrl(thumbKey, 'image/jpeg');

        const faceUrls = [];
        for (const faceId of item.faceIds || []) {
          const faceKey = `events/${slug}/faces/${faceId}.jpg`;
          const facePutUrl = await getPresignedUploadUrl(faceKey, 'image/jpeg');
          const faceUrl = isR2Enabled ? `https://${publicDomain}/${faceKey}` : `/api/photos/file/${faceKey}`;
          faceUrls.push({
            faceId,
            putUrl: facePutUrl,
            r2Url: faceUrl
          });
        }

        results.push({
          filename: item.filename,
          photoPutUrl,
          thumbPutUrl,
          thumbnailPutUrl: thumbPutUrl,
          r2Url,
          thumbnailUrl,
          faces: faceUrls
        });
      }

      return { uploads: results };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to generate pre-signed upload URLs' });
    }
  });

  // Direct file upload endpoint
  fastify.post('/api/gallery/upload-photo-file', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const { filename, fileContent, eventId, eventSlug, isFaceCrop } = req.body;
    if (!filename || !fileContent) {
      return reply.code(400).send({ error: 'Missing filename or fileContent' });
    }

    try {
      const buffer = Buffer.from(fileContent, 'base64');

      let slug = 'general';
      if (eventSlug) {
        slug = eventSlug.toLowerCase().trim();
      } else if (eventId) {
        const event = await prisma.galleryEvent.findUnique({
          where: { id: parseInt(eventId, 10) }
        });
        if (event && event.slug) {
          slug = event.slug.toLowerCase().trim();
        }
      }

      let subfolder = `events/${slug}/photos`;
      if (filename.startsWith('face-') || isFaceCrop) {
        subfolder = `events/${slug}/faces`;
      } else if (filename.startsWith('temp_selfie_') || filename.startsWith('guest_') || filename.startsWith('temp_profile_verify_')) {
        subfolder = `users/selfies`;
      }

      const r2Url = await uploadAsset(buffer, filename, subfolder, 'image/jpeg');
      return { r2Url, thumbnailUrl: null };
    } catch (err) {
      req.log.error(err);
      if (err.message && err.message.includes('R2 storage')) {
        return reply.code(500).send({ error: err.message });
      }
      return reply.code(500).send({ error: 'Failed to save uploaded file' });
    }
  });

  // Update gallery event details (title, date)
  fastify.patch('/api/gallery/events/:id', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { title, date } = req.body;

    try {
      const updateData = {};
      if (title !== undefined) updateData.title = title;
      if (date !== undefined) {
        updateData.date = date ? new Date(date) : null;
      }

      const event = await prisma.galleryEvent.update({
        where: { id: eventId },
        data: updateData
      });

      return { success: true, event };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to update gallery details' });
    }
  });

  // Upload and set cover photo
  fastify.post('/api/gallery/events/:id/covers', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { type, filename, fileContent } = req.body;
    if (!type || !filename || !fileContent) {
      return reply.code(400).send({ error: 'Missing type, filename, or fileContent' });
    }
    if (!['horizontal', 'vertical', 'square32'].includes(type)) {
      return reply.code(400).send({ error: 'Invalid type. Must be horizontal, vertical, or square32' });
    }

    try {
      const dbEvent = await prisma.galleryEvent.findUnique({
        where: { id: eventId }
      });
      if (!dbEvent) {
        return reply.code(404).send({ error: 'Gallery event not found' });
      }
      const slug = dbEvent.slug.toLowerCase().trim();

      const buffer = Buffer.from(fileContent, 'base64');
      const subfolder = `events/${slug}/covers`;

      const updateData = {};
      const sharp = require('sharp');

      if (type === 'horizontal') {
        const buffer169 = await sharp(buffer)
          .resize(1920, 1080, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 82 })
          .toBuffer();
        const filename169 = `cover_${eventId}_horizontal_${Date.now()}_${filename}`;
        const r2Url169 = await uploadAsset(buffer169, filename169, subfolder, 'image/jpeg');
        updateData.coverPhotoUrl = r2Url169;

        const buffer32 = await sharp(buffer)
          .resize(1200, 800, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 82 })
          .toBuffer();
        const filename32 = `cover_${eventId}_square32_${Date.now()}_${filename}`;
        const r2Url32 = await uploadAsset(buffer32, filename32, subfolder, 'image/jpeg');
        updateData.coverPhotoSquareUrl = r2Url32;
      } else if (type === 'square32') {
        const buffer32 = await sharp(buffer)
          .resize(1200, 800, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 82 })
          .toBuffer();
        const filename32 = `cover_${eventId}_square32_${Date.now()}_${filename}`;
        const r2Url32 = await uploadAsset(buffer32, filename32, subfolder, 'image/jpeg');
        updateData.coverPhotoSquareUrl = r2Url32;
      } else {
        const filenameMobile = `cover_${eventId}_vertical_${Date.now()}_${filename}`;
        const r2UrlMobile = await uploadAsset(buffer, filenameMobile, subfolder, 'image/jpeg');
        updateData.coverPhotoMobileUrl = r2UrlMobile;
      }

      if (type === 'horizontal') {
        if (dbEvent.coverPhotoUrl) await deleteAsset(dbEvent.coverPhotoUrl).catch(() => {});
        if (dbEvent.coverPhotoSquareUrl) await deleteAsset(dbEvent.coverPhotoSquareUrl).catch(() => {});
      } else if (type === 'square32') {
        if (dbEvent.coverPhotoSquareUrl) await deleteAsset(dbEvent.coverPhotoSquareUrl).catch(() => {});
      } else {
        if (dbEvent.coverPhotoMobileUrl) await deleteAsset(dbEvent.coverPhotoMobileUrl).catch(() => {});
      }

      const updatedEvent = await prisma.galleryEvent.update({
        where: { id: eventId },
        data: updateData
      });

      const primaryUrl = type === 'horizontal' ? updateData.coverPhotoUrl : (type === 'square32' ? updateData.coverPhotoSquareUrl : updateData.coverPhotoMobileUrl);
      return { success: true, url: primaryUrl, event: updatedEvent };
    } catch (err) {
      req.log.error(err);
      if (err.message && err.message.includes('R2 storage')) {
        return reply.code(500).send({ error: err.message });
      }
      return reply.code(500).send({ error: 'Failed to upload cover photo' });
    }
  });

  // Upload and update cover/poster for an uploaded video photo
  fastify.post('/api/gallery/events/:id/photos/:photoId/cover', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const photoId = parseInt(req.params.photoId, 10);
    const { filename, fileContent } = req.body;

    if (!fileContent) {
      return reply.code(400).send({ error: 'Missing fileContent (base64 image)' });
    }

    try {
      const dbEvent = await prisma.galleryEvent.findUnique({
        where: { id: eventId }
      });
      if (!dbEvent) {
        return reply.code(404).send({ error: 'Gallery event not found' });
      }

      const photo = await prisma.photo.findFirst({
        where: { id: photoId, eventId }
      });
      if (!photo) {
        return reply.code(404).send({ error: 'Photo/video not found' });
      }

      const slug = dbEvent.slug.toLowerCase().trim();
      const buffer = Buffer.from(fileContent, 'base64');
      const sharp = require('sharp');

      // Determine orientation: inspect video dimensions from DB or cover image metadata
      let isVertical = false;
      if (photo.width && photo.height) {
        isVertical = photo.height > photo.width;
      } else {
        const coverMeta = await sharp(buffer).metadata();
        let cWidth = coverMeta.width || 1920;
        let cHeight = coverMeta.height || 1080;
        if (coverMeta.orientation && coverMeta.orientation >= 5) {
          cWidth = coverMeta.height;
          cHeight = coverMeta.width;
        }
        isVertical = cHeight > cWidth;
      }

      const targetW = isVertical ? 1080 : 1920;
      const targetH = isVertical ? 1920 : 1080;

      let posterBuffer;
      try {
        posterBuffer = await sharp(buffer)
          .rotate()
          .resize(targetW, targetH, { fit: 'cover', position: 'attention' })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch (coverErr) {
        posterBuffer = await sharp(buffer)
          .rotate()
          .resize(targetW, targetH, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 85 })
          .toBuffer();
      }

      const baseName = path.basename(photo.filename, path.extname(photo.filename));
      const thumbFilename = `thumb_${baseName}_${Date.now()}.jpg`;
      const subfolder = `events/${slug}/thumbnails`;

      const newThumbnailUrl = await uploadAsset(posterBuffer, thumbFilename, subfolder, 'image/jpeg');

      // Delete old thumbnail asset from R2 if one existed
      if (photo.thumbnailUrl) {
        await deleteAsset(photo.thumbnailUrl).catch(() => {});
      }

      const currentExif = (photo.exif && typeof photo.exif === 'object') ? photo.exif : {};
      const updatedPhoto = await prisma.photo.update({
        where: { id: photoId },
        data: {
          thumbnailUrl: newThumbnailUrl,
          exif: {
            ...currentExif,
            hasBakedCover: true,
            isCoverBaked: true
          }
        }
      });

      return {
        success: true,
        thumbnailUrl: newThumbnailUrl,
        photo: updatedPhoto
      };
    } catch (err) {
      req.log.error(err);
      if (err.message && err.message.includes('R2 storage')) {
        return reply.code(500).send({ error: err.message });
      }
      return reply.code(500).send({ error: 'Failed to update video cover' });
    }
  });

  // Attach or replace video for an existing photo/film record (e.g. converting a Coming Soon poster to a full active video)
  fastify.post('/api/gallery/events/:id/photos/:photoId/attach-video', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const photoId = parseInt(req.params.photoId, 10);
    const { r2Url, filename, fileSize, width, height, duration } = req.body || {};

    if (!r2Url || !filename) {
      return reply.code(400).send({ error: 'Missing r2Url or filename' });
    }

    try {
      const photo = await prisma.photo.findFirst({
        where: { id: photoId, eventId }
      });
      if (!photo) {
        return reply.code(404).send({ error: 'Photo/film not found' });
      }

      // If previous record had an actual video at r2Url, delete old video asset from R2
      const isOldVideo = ['.mp4', '.mov', '.m4v'].some(ext => (photo.filename || photo.r2Url || '').toLowerCase().endsWith(ext));
      if (isOldVideo && photo.r2Url && photo.r2Url !== r2Url) {
        await deleteAsset(photo.r2Url).catch(() => {});
      }

      const currentExif = (photo.exif && typeof photo.exif === 'object') ? photo.exif : {};
      const updatedExif = {
        ...currentExif,
        isComingSoon: false, // Automatically remove Coming Soon!
        fileSize: typeof fileSize === 'number' ? fileSize : (currentExif.fileSize || photo.fileSize),
        videoWidth: width || currentExif.videoWidth,
        videoHeight: height || currentExif.videoHeight,
        duration: duration || currentExif.duration
      };

      // If subtitle was 'COMING SOON • TEASER POSTER', update it to chapter duration if available
      if (updatedExif.subtitle === 'COMING SOON • TEASER POSTER') {
        const mins = duration ? Math.round(duration / 60) : 0;
        updatedExif.subtitle = mins > 0 ? `CHAPTER I • ${mins} MIN` : 'THE WEDDING FILM';
      }

      const updatedPhoto = await prisma.photo.update({
        where: { id: photoId },
        data: {
          r2Url,
          filename,
          fileSize: typeof fileSize === 'number' ? Math.min(Math.round(fileSize), 2147483647) : photo.fileSize,
          width: width || photo.width,
          height: height || photo.height,
          exif: updatedExif
        }
      });

      return {
        success: true,
        photo: {
          ...updatedPhoto,
          isComingSoon: false,
          hasBakedCover: Boolean(updatedExif.hasBakedCover || updatedExif.isCoverBaked),
          isCoverBaked: Boolean(updatedExif.hasBakedCover || updatedExif.isCoverBaked)
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to attach video to film' });
    }
  });

  // Set or toggle featured video for a gallery (at most 1 featured video per gallery)
  fastify.post('/api/gallery/events/:id/photos/:photoId/feature', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const photoId = parseInt(req.params.photoId, 10);
    const requestedState = req.body?.isFeatured;

    try {
      const photo = await prisma.photo.findFirst({
        where: { id: photoId, eventId }
      });
      if (!photo) {
        return reply.code(404).send({ error: 'Photo/video not found in this gallery' });
      }

      const isCurrentlyFeatured = Boolean(photo.exif && photo.exif.isFeatured);
      const newFeaturedState = typeof requestedState === 'boolean' ? requestedState : !isCurrentlyFeatured;

      if (newFeaturedState) {
        // Enforce at most 1 featured video per gallery: unfeature any other photos in this gallery
        const existingFeatured = await prisma.photo.findMany({
          where: { eventId, exif: { path: ['isFeatured'], equals: true } }
        });
        for (const ef of existingFeatured) {
          if (ef.id !== photoId) {
            await prisma.photo.update({
              where: { id: ef.id },
              data: { exif: { ...(ef.exif || {}), isFeatured: false } }
            });
          }
        }

        const updated = await prisma.photo.update({
          where: { id: photoId },
          data: { exif: { ...(photo.exif || {}), isFeatured: true } }
        });

        return {
          success: true,
          photoId,
          isFeatured: true,
          photo: updated
        };
      } else {
        const updated = await prisma.photo.update({
          where: { id: photoId },
          data: { exif: { ...(photo.exif || {}), isFeatured: false } }
        });

        return {
          success: true,
          photoId,
          isFeatured: false,
          photo: updated
        };
      }
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to update featured status' });
    }
  });

  // Update photo/video metadata (title, description, cinemaCategory, sortOrder, isFeatured)
  fastify.patch('/api/gallery/events/:id/photos/:photoId', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const photoId = parseInt(req.params.photoId, 10);
    const { title, subtitle, description, cinemaCategory, sortOrder, isFeatured, tabName, isComingSoon, hasBakedCover } = req.body || {};

    try {
      const photo = await prisma.photo.findFirst({
        where: { id: photoId, eventId }
      });
      if (!photo) {
        return reply.code(404).send({ error: 'Photo/video not found in this gallery' });
      }

      if (isFeatured === true) {
        const existingFeatured = await prisma.photo.findMany({
          where: { eventId, exif: { path: ['isFeatured'], equals: true } }
        });
        for (const ef of existingFeatured) {
          if (ef.id !== photoId) {
            await prisma.photo.update({
              where: { id: ef.id },
              data: { exif: { ...(ef.exif || {}), isFeatured: false } }
            });
          }
        }
      }

      const currentExif = (photo.exif && typeof photo.exif === 'object') ? photo.exif : {};
      const updatedExif = { ...currentExif };

      if (title !== undefined) updatedExif.title = title ? String(title).trim() : null;
      if (subtitle !== undefined) updatedExif.subtitle = subtitle ? String(subtitle).trim() : null;
      if (description !== undefined) updatedExif.description = description ? String(description).trim() : null;
      if (cinemaCategory !== undefined) updatedExif.cinemaCategory = cinemaCategory ? String(cinemaCategory).trim() : null;
      if (sortOrder !== undefined) updatedExif.sortOrder = typeof sortOrder === 'number' ? sortOrder : parseInt(sortOrder, 10) || 0;
      const isVideoExt = ['.mp4', '.mov', '.m4v'].some(ext => (photo.filename || photo.r2Url || '').toLowerCase().endsWith(ext));
      const targetTab = (tabName !== undefined && typeof tabName === 'string') ? tabName : (photo.tabName || '');
      const isCinemaTab = String(targetTab).trim().toUpperCase() === 'CINEMA';
      const isPhotoOnlyCinema = isCinemaTab && !isVideoExt;
      const effectiveComingSoon = (isComingSoon !== undefined)
        ? Boolean(isComingSoon)
        : Boolean(currentExif.isComingSoon || isPhotoOnlyCinema);

      if (effectiveComingSoon) updatedExif.isComingSoon = true;
      else if (isComingSoon !== undefined) updatedExif.isComingSoon = false;

      if (hasBakedCover !== undefined) {
        updatedExif.hasBakedCover = Boolean(hasBakedCover);
        updatedExif.isCoverBaked = Boolean(hasBakedCover);
      }

      const updateData = { exif: updatedExif };
      if (tabName !== undefined && typeof tabName === 'string') {
        updateData.tabName = tabName.trim();
      }

      const updated = await prisma.photo.update({
        where: { id: photoId },
        data: updateData
      });

      return {
        success: true,
        photoId,
        photo: {
          ...updated,
          title: updatedExif.title,
          description: updatedExif.description,
          cinemaCategory: updatedExif.cinemaCategory,
          sortOrder: updatedExif.sortOrder,
          isFeatured: Boolean(updatedExif.isFeatured)
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to update photo/video metadata' });
    }
  });

  // Reorder photos/videos in batch
  fastify.post('/api/gallery/events/:id/photos/reorder', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { orders } = req.body || {};

    if (!Array.isArray(orders) || orders.length === 0) {
      return reply.code(400).send({ error: 'Missing or invalid orders array' });
    }

    try {
      for (const item of orders) {
        const pId = parseInt(item.photoId || item.id, 10);
        const orderNum = parseInt(item.sortOrder, 10) || 0;
        if (pId) {
          const photo = await prisma.photo.findFirst({ where: { id: pId, eventId } });
          if (photo) {
            const curExif = (photo.exif && typeof photo.exif === 'object') ? photo.exif : {};
            const nextExif = { ...curExif, sortOrder: orderNum };
            if (item.cinemaCategory && typeof item.cinemaCategory === 'string') {
              nextExif.cinemaCategory = item.cinemaCategory.trim();
            }
            await prisma.photo.update({
              where: { id: pId },
              data: { exif: nextExif }
            });
          }
        }
      }

      return { success: true, count: orders.length };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to reorder photos/videos' });
    }
  });

  // Bulk upload photo metadata and face vectors
  fastify.post('/api/gallery/events/:id/photos/bulk', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { photos, isFaceScannerOffline } = req.body;

    if (!photos || !Array.isArray(photos)) {
      return reply.code(400).send({ error: 'Invalid photos array payload' });
    }

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      const results = [];
      const facesScanned = isFaceScannerOffline ? false : true;

      for (const p of photos) {
        const hasThumbnail = fs.existsSync(path.join(__dirname, '..', '..', 'uploads', 'photos', 'events', event.slug, 'thumbnails', `thumb_${p.filename}`));
        const thumbnailUrl = p.thumbnailUrl || (hasThumbnail ? `/api/photos/file/events/${event.slug}/thumbnails/thumb_${encodeURIComponent(p.filename)}` : null);

        const isFeaturedItem = Boolean(p.isFeatured || (p.exif && p.exif.isFeatured));
        if (isFeaturedItem) {
          // Unfeature any existing photo in this event to enforce at most 1 featured video per gallery
          const existingFeatured = await prisma.photo.findMany({
            where: { eventId, exif: { path: ['isFeatured'], equals: true } }
          });
          for (const ef of existingFeatured) {
            await prisma.photo.update({
              where: { id: ef.id },
              data: { exif: { ...(ef.exif || {}), isFeatured: false } }
            });
          }
        }
        const safeFileSize = typeof p.fileSize === 'number' ? Math.min(Math.round(p.fileSize), 2147483647) : 0;
        const safeOriginalSize = typeof p.originalSize === 'number' ? Math.min(Math.round(p.originalSize), 2147483647) : null;
        const isVideoExt = ['.mp4', '.mov', '.m4v'].some(ext => (p.filename || p.r2Url || '').toLowerCase().endsWith(ext));
        const isCinemaTab = String(p.tabName || '').trim().toUpperCase() === 'CINEMA';
        const isPhotoOnlyCinema = isCinemaTab && !isVideoExt;
        const effectiveComingSoon = Boolean(p.isComingSoon || p.exif?.isComingSoon || isPhotoOnlyCinema);

        const isBakedCover = Boolean(
          p.hasBakedCover ||
          p.isCoverBaked ||
          p.exif?.hasBakedCover ||
          p.exif?.isCoverBaked
        );

        const photoExif = {
          ...(p.exif || {}),
          ...(typeof p.fileSize === 'number' ? { fileSize: p.fileSize } : {}),
          ...(typeof p.originalSize === 'number' ? { originalFileSize: p.originalSize } : {}),
          ...(isFeaturedItem ? { isFeatured: true } : {}),
          ...(p.title ? { title: String(p.title).trim() } : {}),
          ...(p.subtitle ? { subtitle: String(p.subtitle).trim() } : (effectiveComingSoon ? { subtitle: 'COMING SOON • TEASER POSTER' } : {})),
          ...(p.description ? { description: String(p.description).trim() } : {}),
          ...(p.cinemaCategory ? { cinemaCategory: String(p.cinemaCategory).trim() } : {}),
          ...(effectiveComingSoon ? { isComingSoon: true } : {}),
          ...(isBakedCover ? { hasBakedCover: true, isCoverBaked: true } : {}),
          ...(typeof p.sortOrder === 'number' ? { sortOrder: p.sortOrder } : {})
        };

        const photo = await prisma.photo.create({
          data: {
            eventId,
            r2Url: p.r2Url,
            thumbnailUrl,
            filename: p.filename,
            fileSize: safeFileSize,
            originalFileSize: safeOriginalSize,
            tabName: p.tabName || null,
            exif: photoExif,
            capturedAt: p.capturedAt ? new Date(p.capturedAt) : null,
            facesScanned,
            width: p.width || null,
            height: p.height || null
          }
        });

        if (p.faces && p.faces.length > 0) {
          await qdrant.upsertVectors(eventId, photo.id, p.faces);
        }

        results.push(photo);
      }

      if (isFaceScannerOffline) {
        await prisma.galleryEvent.update({
          where: { id: eventId },
          data: {
            galleryFacesComplete: false,
            clustersDirty: true
          }
        });
      } else {
        await prisma.galleryEvent.update({
          where: { id: eventId },
          data: { clustersDirty: true }
        });
      }

      return { status: 'success', count: results.length, photos: results };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to upload photo metadata' });
    }
  });

  // Fetch unscanned photos for an event
  fastify.get('/api/gallery/events/:id/photos/unscanned', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    try {
      const photos = await prisma.photo.findMany({
        where: {
          eventId,
          facesScanned: false
        },
        select: {
          id: true,
          filename: true,
          r2Url: true
        },
        take: 50
      });
      return { photos };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to fetch unscanned photos' });
    }
  });

  // Save backfilled face crops and vectors for a photo
  fastify.post('/api/gallery/events/:id/photos/:photoId/vectors', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const photoId = parseInt(req.params.photoId, 10);
    const { faces } = req.body;

    try {
      if (faces && faces.length > 0) {
        await qdrant.upsertVectors(eventId, photoId, faces);
      }

      await prisma.photo.update({
        where: { id: photoId },
        data: { facesScanned: true }
      });

      const unscannedCount = await prisma.photo.count({
        where: {
          eventId,
          facesScanned: false
        }
      });

      if (unscannedCount === 0) {
        await prisma.galleryEvent.update({
          where: { id: eventId },
          data: {
            galleryFacesComplete: true,
            clustersDirty: true
          }
        });
      }

      return { success: true, remaining: unscannedCount };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to save backfilled vectors' });
    }
  });

  // Explicitly mark cluster cache as dirty
  fastify.post('/api/gallery/events/:id/finalize-upload', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    try {
      await prisma.galleryEvent.update({
        where: { id: eventId },
        data: { clustersDirty: true }
      });
      return { success: true, message: 'Upload finalized. Cluster cache marked for refresh.' };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to finalize upload' });
    }
  });

  // Get summary of guest likes for a specific event
  fastify.get('/api/gallery/events/:id/likes-summary', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    if (isNaN(eventId)) {
      return reply.code(400).send({ error: 'Invalid event ID' });
    }

    try {
      const guests = await prisma.guest.findMany({
        where: { eventId },
        include: {
          likes: {
            include: {
              photo: {
                select: {
                  id: true,
                  r2Url: true,
                  filename: true,
                  fileSize: true,
                  tabName: true
                }
              }
            }
          }
        }
      });

      const summary = guests.map(guest => ({
        id: guest.id,
        name: guest.name,
        email: guest.email,
        phoneNumber: guest.phoneNumber,
        hasFullAccess: guest.hasFullAccess,
        likesCount: guest.likes.filter(like => like.photo).length,
        likedPhotos: guest.likes.filter(like => like.photo).map(like => ({
          id: like.photo.id,
          r2Url: like.photo.r2Url,
          filename: like.photo.filename,
          fileSize: like.photo.fileSize,
          tabName: like.photo.tabName
        }))
      }));

      summary.sort((a, b) => b.likesCount - a.likesCount);

      return { guests: summary };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve guest likes summary' });
    }
  });

  // Update a guest's access level & displayRole (Bride/Groom/Guest)
  fastify.post('/api/gallery/events/:id/guests/:guestId/access', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const guestId = parseInt(req.params.guestId, 10);
    const { hasFullAccess, displayRole } = req.body || {};

    if (isNaN(eventId) || isNaN(guestId)) {
      return reply.code(400).send({ error: 'Invalid request parameters' });
    }

    try {
      const guest = await prisma.guest.findFirst({
        where: { id: guestId, eventId }
      });

      if (!guest) {
        return reply.code(404).send({ error: 'Guest not found under this event' });
      }

      let newFullAccess = hasFullAccess !== undefined ? Boolean(hasFullAccess) : guest.hasFullAccess;
      let newDisplayRole = displayRole !== undefined ? displayRole : guest.displayRole;

      if (newDisplayRole === 'BRIDE' || newDisplayRole === 'GROOM') {
        newFullAccess = true;

        await pool.query(
          `UPDATE guests SET display_role = NULL WHERE event_id = $1 AND display_role = $2 AND id != $3`,
          [eventId, newDisplayRole, guestId]
        );
      }

      const updated = await prisma.guest.update({
        where: { id: guestId },
        data: {
          hasFullAccess: newFullAccess,
          displayRole: newDisplayRole
        }
      });

      return {
        success: true,
        guest: {
          id: updated.id,
          email: updated.email,
          hasFullAccess: updated.hasFullAccess,
          displayRole: updated.displayRole
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to update guest access' });
    }
  });
};
