const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prisma } = require('../prisma');
const qdrant = require('../utils/qdrant');
const { uploadAsset, deleteAsset, getPresignedUploadUrl } = require('../utils/r2');
const faceRecManager = require('../utils/faceRecManager');

const PHOTO_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'photos');

function getImageContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

function getDerivedThumbnail(thumbnailUrl, r2Url) {
  if (thumbnailUrl) return thumbnailUrl;
  if (r2Url && r2Url.startsWith('/api/photos/file/')) {
    const prefix = '/api/photos/file/events/';
    if (r2Url.startsWith(prefix)) {
      const remaining = r2Url.substring(prefix.length);
      const replaced = remaining.replace('/photos/', '/thumbnails/thumb_');
      return prefix + replaced;
    }
  }
  return null;
}

function getArchiver() {
  const arch = require('archiver');
  if (typeof arch === 'function') {
    return arch;
  }
  if (arch && typeof arch.default === 'function') {
    return arch.default;
  }
  return function(format, options) {
    if (format === 'zip') {
      return new arch.ZipArchive(options);
    }
    if (format === 'tar') {
      return new arch.TarArchive(options);
    }
    return new arch.Archiver(format, options);
  };
}

module.exports = async function galleryRoutes(fastify, opts) {
  const { pool, requireAdmin, requireAuth } = opts;

  function checkPreviewToken(req) {
    try {
      const token = req.query.previewToken || req.headers['x-preview-token'] || (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') && req.headers.authorization.split(' ')[1]);
      if (!token) return null;
      
      let decoded = null;
      try {
        const sharedSecret = 'mistyvisuals-shared-preview-secret-key-2026';
        decoded = fastify.jwt.verify(token, { secret: sharedSecret });
      } catch (err) {
        // Fallback to default verify
        decoded = fastify.jwt.verify(token);
      }

      if (decoded && decoded.isAdminPreview && req.params.slug && decoded.slug.toLowerCase().trim() === req.params.slug.toLowerCase().trim()) {
        return decoded;
      }
    } catch (e) {
      // invalid/expired token
    }
    return null;
  }

  // File serving endpoint for gallery cover photos and matched event images
  fastify.get('/api/photos/file/*', async (req, reply) => {
    const relativePath = req.params['*']
    if (!relativePath) return reply.code(404).send({ error: 'Not found' })
    const filePath = path.normalize(path.join(PHOTO_UPLOAD_DIR, relativePath))
    if (!filePath.startsWith(PHOTO_UPLOAD_DIR)) {
      return reply.code(403).send({ error: 'Forbidden' })
    }
    try {
      await fs.promises.stat(filePath)
      reply.type(getImageContentType(path.basename(filePath)))
      return reply.send(fs.createReadStream(filePath))
    } catch (err) {
      const { isR2Enabled } = require('../utils/r2');
      if (isR2Enabled && process.env.R2_PUBLIC_DOMAIN_URL) {
        let publicDomain = process.env.R2_PUBLIC_DOMAIN_URL.trim();
        if (publicDomain.startsWith('http://')) publicDomain = publicDomain.substring(7);
        if (publicDomain.startsWith('https://')) publicDomain = publicDomain.substring(8);
        const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
        return reply.redirect(`https://${publicDomain}/${encodedPath}`);
      }
      return reply.code(404).send({ error: 'Not found' })
    }
  })

  // In-memory cache for guest anchor vectors and extra vectors from Option B.
  const guestAnchors = {}; // key: "email_eventId", value: { anchorVector: [...], extraVectors: [[...], ...] }

  const checkGuestSelfie = (guestId) => {
    const selfiePath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `guest_${guestId}.jpg`);
    return fs.existsSync(selfiePath);
  };

  const checkUserSelfie = (userId) => {
    if (!userId) return false;
    const selfiePath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `user_${userId}.jpg`);
    return fs.existsSync(selfiePath);
  };

  const ensureUserSelfieMigrated = async (userId, email) => {
    if (!userId || !email) return false;
    const newJpgPath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `user_${userId}.jpg`);
    if (fs.existsSync(newJpgPath)) return true;

    try {
      const guests = await prisma.guest.findMany({ where: { email } });
      for (const guest of guests) {
        const oldJpgPath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `guest_${guest.id}.jpg`);
        const oldJsonPath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `guest_${guest.id}.json`);
        
        if (fs.existsSync(oldJpgPath)) {
          const newJsonPath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `user_${userId}.json`);
          fs.copyFileSync(oldJpgPath, newJpgPath);
          if (fs.existsSync(oldJsonPath)) {
            fs.copyFileSync(oldJsonPath, newJsonPath);
          }
          fastify.log.info(`[Selfie On-The-Fly Migration] Migrated guest_${guest.id} -> user_${userId} for ${email}`);
          return true;
        }
      }
    } catch (err) {
      fastify.log.error('On-the-fly selfie migration failed:', err);
    }
    return false;
  };

  function logTelemetry(entry) {
    const telemetryPath = path.join(__dirname, '..', 'db', 'telemetry.json');
    let data = [];
    try {
      if (fs.existsSync(telemetryPath)) {
        data = JSON.parse(fs.readFileSync(telemetryPath, 'utf8'));
      }
    } catch (err) {
      // Ignore
    }
    data.push({
      timestamp: new Date().toISOString(),
      ...entry
    });
    try {
      const dir = path.dirname(telemetryPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(telemetryPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      // Ignore
    }
  }

  // Middleware helper to verify guest JWT token
  const { verifyGuestAuth } = require('../utils/galleryAuth');

  /* ========================================================================= */
  /* ADMIN API ROUTINGS                                                        */
  /* ========================================================================= */

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

      // Fetch matching projects from pool to get their UUIDs and current slugs
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

      // Combine them
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
      // Find the gallery event
      const galleryEvent = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!galleryEvent) {
        return reply.code(404).send({ error: 'Gallery event not found' });
      }

      // Fetch CRM project_events
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

      // Merge saved tabs with CRM events, keeping Highlights first
      let mergedTabs = galleryEvent.tabs || [];
      if (mergedTabs.length <= 1) {
        // If it only has Highlights or is empty, merge with CRM events
        mergedTabs = ['Highlights', ...crmEvents.filter(e => e !== 'Highlights')];
        
        // Save the merged tabs to the database so they are persisted
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

  // Create or return existing gallery event for a project (idempotent, keyed on projectId)
  // projectId (UUID) is the stable link — safe to call multiple times, never creates duplicates.
  fastify.post('/api/gallery/events', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const { slug, title, date, qrToken, coverPhotoUrl, leadId, projectId } = req.body;
    if (!slug || !title || !date) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }

    // Deterministic qrToken: slug_qr (no random suffix — idempotent)
    const resolvedQrToken = qrToken || `${slug.toLowerCase().trim()}_qr`;

    try {
      // Helper to fetch initial tabs from CRM project_events table
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
      // Always ensure "Highlights" is the first tab
      const tabsWithHighlights = ['Highlights', ...initialTabs.filter(t => t !== 'Highlights')];

      // If projectId is provided, use upsert on projectId — completely idempotent
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
            tabs: tabsWithHighlights
          }
        });
        return event;
      }

      // Legacy path (no projectId): check slug uniqueness and create
      const existing = await prisma.galleryEvent.findFirst({
        where: { OR: [{ slug: slug.toLowerCase().trim() }, { qrToken: resolvedQrToken }] }
      });
      if (existing) {
        return existing; // Return existing instead of erroring — idempotent
      }

      const event = await prisma.galleryEvent.create({
        data: {
          slug: slug.toLowerCase().trim(),
          title,
          date: new Date(date),
          qrToken: resolvedQrToken,
          coverPhotoUrl: coverPhotoUrl || null,
          leadId: leadId ? parseInt(leadId, 10) : null,
          tabs: tabsWithHighlights
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

      // Update the tab name inside the tabs array
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

  // Helper function to delete photo assets and database/Qdrant records in parallel chunks
  async function deletePhotosAssets(photos, slug, log) {
    const { isR2Enabled } = require('../utils/r2');
    let publicDomain = '';
    if (isR2Enabled && process.env.R2_PUBLIC_DOMAIN_URL) {
      publicDomain = process.env.R2_PUBLIC_DOMAIN_URL.trim();
      if (publicDomain.startsWith('http://')) publicDomain = publicDomain.substring(7);
      if (publicDomain.startsWith('https://')) publicDomain = publicDomain.substring(8);
    }

    const chunkSize = 15; // concurrency level
    for (let i = 0; i < photos.length; i += chunkSize) {
      const chunk = photos.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (p) => {
        try {
          // Delete associated face crops from R2 if R2 is enabled
          const faceIds = await qdrant.getFaceIdsForPhoto(p.id);
          await Promise.all(faceIds.map(async (faceId) => {
            if (isR2Enabled && publicDomain && slug) {
              const faceUrl = `https://${publicDomain}/events/${slug}/photos/${faceId}.jpg`;
              await deleteAsset(faceUrl).catch(() => {});
              const faceUrlAlt = `https://${publicDomain}/events/${slug}/faces/${faceId}.jpg`;
              await deleteAsset(faceUrlAlt).catch(() => {});
            } else {
              const targetDir = path.join(__dirname, '..', 'uploads', 'photos');
              const localFacePath = path.join(targetDir, `${faceId}.jpg`);
              if (fs.existsSync(localFacePath)) {
                try { fs.unlinkSync(localFacePath); } catch (e) {}
              }
            }
          }));

          // Delete from Qdrant
          await qdrant.deleteVectorsForPhoto(p.id);

          // Delete thumbnail from R2
          if (p.thumbnailUrl) {
            await deleteAsset(p.thumbnailUrl).catch(() => {});
          } else if (isR2Enabled && publicDomain && slug && p.filename) {
            const thumbFilename = `thumb_${p.filename}`;
            const thumbSubfolder = `events/${slug}/thumbnails`;
            const thumbKey = `${thumbSubfolder}/${thumbFilename}`;
            const thumbUrl = `https://${publicDomain}/${thumbKey}`;
            await deleteAsset(thumbUrl).catch(() => {});
          }

          // Delete from R2 (or local disk fallback)
          if (p.r2Url) {
            await deleteAsset(p.r2Url).catch(() => {});
          }

          // Delete from disk (legacy local fallback)
          if (p.filename) {
            const targetDir = path.join(__dirname, '..', 'uploads', 'photos');
            const filePath = path.join(targetDir, p.filename);
            if (fs.existsSync(filePath)) {
              try { fs.unlinkSync(filePath); } catch (e) {}
            }

            // Delete grid thumbnail
            const thumbPath = path.join(targetDir, `thumb_${p.filename}`);
            if (fs.existsSync(thumbPath)) {
              try { fs.unlinkSync(thumbPath); } catch (e) {}
            }

            // Delete associated face crop thumbnails
            try {
              const files = fs.readdirSync(targetDir);
              const baseWithoutExt = path.parse(p.filename).name;
              for (const file of files) {
                if (file.startsWith('face-') && file.includes(baseWithoutExt)) {
                  fs.unlinkSync(path.join(targetDir, file));
                }
              }
            } catch (e) {
              log.error(e);
            }
          }
        } catch (err) {
          log.error(`[deletePhotosAssets] Error deleting assets for photo ID ${p.id}:`, err);
        }
      }));
    }
  }

  // Delete all photos belonging to a tab in a gallery event, and remove the tab from tabs list
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

      // Remove the tab from the tabs array case-insensitively
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

      // 1. Delete from database first (guarantees UI consistency immediately)
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

      // 2. Clean up assets asynchronously (connection aborts won't cause stale DB records)
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

      // 1. Delete from database first (guarantees UI consistency immediately)
      const deleted = await prisma.photo.deleteMany({
        where: {
          id: { in: photosToDelete.map(p => p.id) },
          eventId: eventId
        }
      });

      // Mark cluster cache as dirty so face clusters are rebuilt on next request
      await prisma.galleryEvent.update({
        where: { id: eventId },
        data: { clustersDirty: true }
      });

      // 2. Clean up assets asynchronously (connection aborts won't cause stale DB records)
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
      // First verify the targetTab exists on this event
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
    const { uploads } = req.body; // uploads: [{ filename: string, faceIds: string[] }]

    if (!uploads || !Array.isArray(uploads)) {
      return reply.code(400).send({ error: 'Missing or invalid uploads array' });
    }

    try {
      const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      const slug = event.slug.toLowerCase().trim();
      const { isR2Enabled } = require('../utils/r2');
      let publicDomain = '';
      if (isR2Enabled && process.env.R2_PUBLIC_DOMAIN_URL) {
        publicDomain = process.env.R2_PUBLIC_DOMAIN_URL.trim();
        if (publicDomain.startsWith('http://')) publicDomain = publicDomain.substring(7);
        if (publicDomain.startsWith('https://')) publicDomain = publicDomain.substring(8);
      }

      const results = [];
      for (const item of uploads) {
        const photoKey = `events/${slug}/photos/${item.filename}`;
        const thumbKey = `events/${slug}/thumbnails/thumb_${item.filename}`;

        const r2Url = isR2Enabled ? `https://${publicDomain}/${photoKey}` : `/api/photos/file/${photoKey}`;
        const thumbnailUrl = isR2Enabled ? `https://${publicDomain}/${thumbKey}` : `/api/photos/file/${thumbKey}`;

        const photoPutUrl = await getPresignedUploadUrl(photoKey, 'image/jpeg');
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

  // Direct file upload endpoint (used by the desktop uploader app)
  fastify.post('/api/gallery/upload-photo-file', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const { filename, fileContent, eventId, eventSlug, isFaceCrop } = req.body;
    if (!filename || !fileContent) {
      return reply.code(400).send({ error: 'Missing filename or fileContent' });
    }

    try {
      const buffer = Buffer.from(fileContent, 'base64');

      // Resolve event slug name
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

      // Determine correct subfolder layout under uploads/photos/
      let subfolder = `events/${slug}/photos`;
      if (filename.startsWith('face-') || isFaceCrop) {
        subfolder = `events/${slug}/faces`;
      } else if (filename.startsWith('temp_selfie_') || filename.startsWith('guest_') || filename.startsWith('temp_profile_verify_')) {
        subfolder = `events/${slug}/selfies`;
      }

      const r2Url = await uploadAsset(buffer, filename, subfolder, 'image/jpeg');

      // Generate photographer-grade progressive thumbnail if not a face crop / temp file
      let thumbnailUrl = null;
      if (!filename.startsWith('face-') && !filename.startsWith('temp_') && !filename.startsWith('verify_') && !filename.startsWith('guest_')) {
        const thumbFilename = `thumb_${filename}`;
        const thumbSubfolder = `events/${slug}/thumbnails`;
        
        let thumbBuffer = null;
        if (req.body.thumbnailContent) {
          thumbBuffer = Buffer.from(req.body.thumbnailContent, 'base64');
        } else {
          try {
            const sharp = require('sharp');
            thumbBuffer = await sharp(buffer)
              .rotate()  // auto-rotate based on EXIF orientation, then strip the tag
              .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
              .sharpen()
              .jpeg({ quality: 85, progressive: true, mozjpeg: true })
              .toBuffer();
          } catch (thumbErr) {
            req.log.error(`Thumbnail generation failed for ${filename}: ${thumbErr.message}`);
          }
        }

        if (thumbBuffer) {
          thumbnailUrl = await uploadAsset(thumbBuffer, thumbFilename, thumbSubfolder, 'image/jpeg');
        }
      }

      return { r2Url, thumbnailUrl };
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

  // Upload and set cover photo (horizontal or vertical) for a gallery event
  fastify.post('/api/gallery/events/:id/covers', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { type, filename, fileContent } = req.body; // type: 'horizontal' | 'vertical' | 'square32'
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
        // Crop & Resize to 16:9 (1920x1080) for widescreen cover
        const buffer169 = await sharp(buffer)
          .resize(1920, 1080, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 82 })
          .toBuffer();
        const filename169 = `cover_${eventId}_horizontal_${Date.now()}_${filename}`;
        const r2Url169 = await uploadAsset(buffer169, filename169, subfolder, 'image/jpeg');
        updateData.coverPhotoUrl = r2Url169;

        // Crop & Resize to 3:2 (1200x800) for Circle/square card thumbnail
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
        // Vertical (9:16) cover photo - untouched/saved directly or resized
        const filenameMobile = `cover_${eventId}_vertical_${Date.now()}_${filename}`;
        const r2UrlMobile = await uploadAsset(buffer, filenameMobile, subfolder, 'image/jpeg');
        updateData.coverPhotoMobileUrl = r2UrlMobile;
      }

      // Delete old cover(s) from R2 before uploading new ones
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

  // Bulk upload photo metadata and face vectors
  fastify.post('/api/gallery/events/:id/photos/bulk', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const { photos, isFaceScannerOffline } = req.body; // photos: [{ filename, r2Url, fileSize, tabName, exif, capturedAt, faces: [{ faceId, vector }] }]

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
        // Resolve photographer-grade grid thumbnail if exists on disk or payload
        const hasThumbnail = fs.existsSync(path.join(__dirname, '..', 'uploads', 'photos', 'events', event.slug, 'thumbnails', `thumb_${p.filename}`));
        const thumbnailUrl = p.thumbnailUrl || (hasThumbnail ? `/api/photos/file/events/${event.slug}/thumbnails/thumb_${encodeURIComponent(p.filename)}` : null);

        // Create photo record in PostgreSQL with metadata details
        const photo = await prisma.photo.create({
          data: {
            eventId,
            r2Url: p.r2Url,
            thumbnailUrl,
            filename: p.filename,
            fileSize: p.fileSize,
            originalFileSize: p.originalSize || null,
            tabName: p.tabName || null,
            exif: p.exif || null,
            capturedAt: p.capturedAt ? new Date(p.capturedAt) : null,
            facesScanned,
            width: p.width || null,
            height: p.height || null
          }
        });

        // Insert vectors to Qdrant (or mock fallback)
        if (p.faces && p.faces.length > 0) {
          await qdrant.upsertVectors(eventId, photo.id, p.faces);
        }

        results.push(photo);
      }

      // If face scanner was offline, mark the entire gallery's faces as incomplete
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

      return { status: 'success', count: results.length };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to upload photo metadata' });
    }
  });

  // Fetch unscanned photos for an event (used by uploader background backfill)
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
    const { faces } = req.body; // faces: [{ faceId, vector }]

    try {
      // 1. Insert vectors to Qdrant (or mock fallback)
      if (faces && faces.length > 0) {
        await qdrant.upsertVectors(eventId, photoId, faces);
      }

      // 2. Mark this photo's face scanning as complete
      await prisma.photo.update({
        where: { id: photoId },
        data: { facesScanned: true }
      });

      // 3. Check if there are any remaining unscanned photos for this event
      const unscannedCount = await prisma.photo.count({
        where: {
          eventId,
          facesScanned: false
        }
      });

      // 4. If all photos are scanned, mark the gallery event as complete
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

  // Explicitly mark cluster cache as dirty (call this after a full upload batch is complete)
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

  // Get summary of guest likes for a specific event (Admin only)
  fastify.get('/api/gallery/events/:id/likes-summary', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    if (isNaN(eventId)) {
      return reply.code(400).send({ error: 'Invalid event ID' });
    }

    try {
      // Find all guests for this event
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

      // Sort by likesCount desc to show active guests first
      summary.sort((a, b) => b.likesCount - a.likesCount);

      return { guests: summary };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve guest likes summary' });
    }
  });

  // Update a guest's hasFullAccess level (Admin only)
  fastify.post('/api/gallery/events/:id/guests/:guestId/access', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const eventId = parseInt(req.params.id, 10);
    const guestId = parseInt(req.params.guestId, 10);
    const { hasFullAccess } = req.body;

    if (isNaN(eventId) || isNaN(guestId) || hasFullAccess === undefined) {
      return reply.code(400).send({ error: 'Invalid request parameters' });
    }

    try {
      // Verify guest exists under this event
      const guest = await prisma.guest.findFirst({
        where: { id: guestId, eventId }
      });

      if (!guest) {
        return reply.code(404).send({ error: 'Guest not found under this event' });
      }

      const updated = await prisma.guest.update({
        where: { id: guestId },
        data: { hasFullAccess: Boolean(hasFullAccess) }
      });

      return { success: true, guest: { id: updated.id, email: updated.email, hasFullAccess: updated.hasFullAccess } };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to update guest access' });
    }
  });

  /* ========================================================================= */
  /* PUBLIC / GUEST API ROUTINGS                                               */
  /* ========================================================================= */

  // Validate face on an uploaded image without saving or changing anything
  fastify.post('/api/gallery/public/validate-face', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No image uploaded' });
    
    let tempPath = null;
    try {
      const buffer = await data.toBuffer();
      const tempDir = path.join(__dirname, '..', 'uploads', 'temp');
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
          leadId: true
        }
      });

      const isPreview = checkPreviewToken(req);
      if (!event || (!event.active && !isPreview)) {
        return reply.code(404).send({ error: 'Gallery not found or inactive' });
      }

      // Check if event has a passcode configured in projects table
      let hasPasscode = false;
      let resolvedProjectId = event.projectId;
      if (!resolvedProjectId && event.leadId) {
        const projRes = await pool.query(
          `SELECT id FROM projects WHERE lead_id = $1 LIMIT 1`,
          [event.leadId]
        );
        if (projRes.rows.length > 0) {
          resolvedProjectId = projRes.rows[0].id;
        }
      }

      if (resolvedProjectId) {
        const passRes = await pool.query(
          `SELECT passcode, partial_passcode FROM projects WHERE id::text = $1 LIMIT 1`,
          [resolvedProjectId]
        );
        if (passRes.rows.length > 0) {
          const dbPasscode = passRes.rows[0].passcode;
          const dbPartialPasscode = passRes.rows[0].partial_passcode;
          if (dbPasscode || dbPartialPasscode) {
            hasPasscode = true;
          }
        }
      }

      event.hasPasscode = hasPasscode;
      event.isPreviewMode = !!isPreview;

      // Filter tabs to only return those containing at least 1 photo
      const activePhotoTabs = await prisma.photo.groupBy({
        by: ['tabName'],
        where: { 
          eventId: event.id, 
          tabName: { not: null } 
        },
      });
      const activeTabNames = activePhotoTabs.map(t => t.tabName);
      
      event.tabs = (event.tabs || []).filter(tab => activeTabNames.includes(tab));

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
      const isPreview = checkPreviewToken(req);
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event || (!event.active && !isPreview)) {
        return reply.code(404).send({ error: 'Gallery not found' });
      }

      // Try auth (Bearer token from Guest or Admin, or Cookie from Admin)
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
            // Fetch or create the Admin Preview guest
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
          } else if (decoded.role === 'guest' && decoded.eventId === event.id) {
            guestId = decoded.guestId;
            const dbGuest = await prisma.guest.findUnique({
              where: { id: guestId }
            });
            hasFullAccess = dbGuest ? dbGuest.hasFullAccess : decoded.hasFullAccess;
          } else {
            return reply.code(403).send({ error: 'Token does not match this event' });
          }
        } catch (err) {
          // Fall through to cookie auth if token is invalid/expired
          isTokenValid = false;
        }
      }

      if (!isTokenValid) {
        // Fallback: try admin cookie auth (for internal gallery preview)
        const adminAuth = requireAdmin(req, reply);
        if (!adminAuth) return; // requireAdmin already sent 401/403
        hasFullAccess = true; // Admins always have full access
      }

      // Pagination params
      const offset = Math.max(0, parseInt(req.query.offset) || 0);
      const limit  = Math.min(50000, Math.max(1, parseInt(req.query.limit) || 30));
      const tabFilter = (req.query.tab || '').trim();

      // Build where clause — partial access guests only see Highlights
      const whereClause = { eventId: event.id };
      if (!hasFullAccess) {
        whereClause.tabName = 'Highlights';
      } else {
        // Move orphan-tab filtering into DB: only return photos whose tabName is in event.tabs
        // (or has no tabName at all, as a safe fallback)
        const activeTabs = event.tabs || [];
        if (activeTabs.length > 0) {
          whereClause.OR = [
            { tabName: { in: activeTabs } },
            { tabName: null }
          ];
        }
        // Apply per-tab filter if requested (overrides the OR above)
        if (tabFilter) {
          delete whereClause.OR;
          whereClause.tabName = tabFilter;
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

      // Run count and page fetch in parallel
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

      // Fetch the guest's likes with photos
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

      // Filter out likes on deleted photos and map to client-friendly photo format
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

      // Do NOT cache favorites aggressively so it updates in real time
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
      // Verify photo exists and matches event slug
      const photo = await prisma.photo.findUnique({
        where: { id: photoId },
        include: { galleryEvent: true }
      });

      if (!photo || photo.galleryEvent.slug.toLowerCase().trim() !== slug) {
        return reply.code(404).send({ error: 'Photo not found in this gallery' });
      }

      // Check if already liked
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
        // Unlike
        await prisma.photoLike.delete({
          where: { id: existingLike.id }
        });
        liked = false;
      } else {
        // Like
        await prisma.photoLike.create({
          data: {
            photoId,
            guestId
          }
        });
        liked = true;
      }

      // Get updated total likes count
      const likeCount = await prisma.photoLike.count({
        where: { photoId }
      });

      return { liked, likeCount };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to toggle photo like' });
    }
  });

  // Get clustered people from the event photos — ADMIN ONLY (internal gallery preview)
  fastify.get('/api/gallery/public/events/:slug/people', async (req, reply) => {
    const auth = requireAdmin(req, reply);
    if (!auth) return;

    const slug = req.params.slug.toLowerCase().trim();
    try {
      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event) return reply.code(404).send({ error: 'Event not found' });

      // --- CACHE HIT: serve stored result if cluster cache is fresh ---
      if (!event.clustersDirty && event.clustersCache) {
        return { people: event.clustersCache, fromCache: true };
      }

      // --- CACHE MISS: fetch vectors and re-cluster ---
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
        // Fetch all face vectors for this event directly from Qdrant
        const allVectors = await qdrant.getAllVectorsForEvent(event.id);
        dbVectors = allVectors.filter(item => validPhotoIds.has(item.photoId));
      }

      if (dbVectors.length === 0) {
        // Cache the empty result so we don't keep re-running for events with no faces
        await prisma.galleryEvent.update({
          where: { id: event.id },
          data: { clustersCache: [], clustersDirty: false }
        });
        return { people: [] };
      }

      const res = await faceRecManager.clusterFaces(dbVectors);
      
      // Trigger background purge of orphaned face crop files
      purgeOrphanedFacesBackground(req.log);

      if (!res.clusters) {
        await prisma.galleryEvent.update({
          where: { id: event.id },
          data: { clustersCache: [], clustersDirty: false }
        });
        return { people: [] };
      }

      // Build people response from cluster results
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
              // Construct direct R2 URL for the face crop since it's uploaded under events/slug/faces/faceId.jpg
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

      // Save to cache and mark clean
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

      // Enforce live validation for Google Auth
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
        // Simplistic profile payload registration for Apple auth (to be integrated with full JWKS validation in prod)
        verifiedEmail = email;
        verifiedName = name;
        providerId = token; // Treat the identifier token as unique providerId
        if (!verifiedEmail) {
          return reply.code(400).send({ error: 'Apple Auth requires email for first-time login' });
        }
      } else {
        return reply.code(400).send({ error: 'Unsupported authentication provider' });
      }

      // Retrieve passcode and partial_passcode from projects table
      let dbPasscode = null;
      let dbPartialPasscode = null;
      let resolvedProjectId = event.projectId;
      if (!resolvedProjectId && event.leadId) {
        const projRes = await pool.query(
          `SELECT id FROM projects WHERE lead_id = $1 LIMIT 1`,
          [event.leadId]
        );
        if (projRes.rows.length) {
          resolvedProjectId = projRes.rows[0].id;
        }
      }
      if (resolvedProjectId) {
        const passRes = await pool.query(
          `SELECT passcode, partial_passcode FROM projects WHERE id::text = $1 LIMIT 1`,
          [String(resolvedProjectId)]
        );
        if (passRes.rows.length) {
          dbPasscode = passRes.rows[0].passcode;
          dbPartialPasscode = passRes.rows[0].partial_passcode;
        }
      }

      // Find or create guest (check if they exist first)
      let guest = await prisma.guest.findFirst({
        where: { eventId: event.id, email: verifiedEmail }
      });

      // Enforce passcode check
      let isCodeValid = false; // full access flag
      
      // If at least one passcode is configured on the event
      if (dbPasscode || dbPartialPasscode) {
        if (!code) {
          if (!guest) {
            return reply.code(400).send({ error: 'Passcode is required to access this gallery' });
          }
        } else {
          const cleanCode = code.trim().toLowerCase();
          const cleanFull = dbPasscode ? dbPasscode.trim().toLowerCase() : null;
          const cleanPartial = dbPartialPasscode ? dbPartialPasscode.trim().toLowerCase() : null;

          if (cleanFull && cleanCode === cleanFull) {
            isCodeValid = true; // Full access granted
          } else if (cleanPartial && cleanCode === cleanPartial) {
            isCodeValid = false; // Partial access granted
          } else {
            return reply.code(400).send({ error: 'Invalid passcode' });
          }
        }
      }

      // Find or create global user profile
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
        // If code is valid, upgrade access to true. If not, preserve whatever access they already have (never downgrade).
        if (isCodeValid && !guest.hasFullAccess) {
          guest = await prisma.guest.update({
            where: { id: guest.id },
            data: { hasFullAccess: true }
          });
        }
      }

      await ensureUserSelfieMigrated(user.id, verifiedEmail);
      const hasSelfie = checkUserSelfie(user.id);

      // Generate secure guest JWT session
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
          hasSelfie
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
      // Decode and verify global family token
      let decoded;
      try {
        decoded = fastify.jwt.verify(circleToken);
      } catch (jwtErr) {
        return reply.code(401).send({ error: 'Invalid or expired Circle session' });
      }

      if (decoded.role !== 'family' || !decoded.email) {
        return reply.code(403).send({ error: 'Access denied: Invalid session role' });
      }

      const event = await prisma.galleryEvent.findUnique({ where: { slug } });
      if (!event || !event.active) return reply.code(404).send({ error: 'Event not found or inactive' });

      // Retrieve passcode and partial_passcode from projects table
      let dbPasscode = null;
      let dbPartialPasscode = null;
      let resolvedProjectId = event.projectId;
      if (!resolvedProjectId && event.leadId) {
        const projRes = await pool.query(
          `SELECT id FROM projects WHERE lead_id = $1 LIMIT 1`,
          [event.leadId]
        );
        if (projRes.rows.length) {
          resolvedProjectId = projRes.rows[0].id;
        }
      }
      if (resolvedProjectId) {
        const passRes = await pool.query(
          `SELECT passcode, partial_passcode FROM projects WHERE id::text = $1 LIMIT 1`,
          [String(resolvedProjectId)]
        );
        if (passRes.rows.length) {
          dbPasscode = passRes.rows[0].passcode;
          dbPartialPasscode = passRes.rows[0].partial_passcode;
        }
      }

      // Find global user profile
      const user = await prisma.circleUser.findUnique({
        where: { email: decoded.email }
      });
      if (!user) return reply.code(404).send({ error: 'User profile not found' });

      // Find or create guest for this wedding event
      let guest = await prisma.guest.findFirst({
        where: { eventId: event.id, email: decoded.email }
      });

      // Enforce passcode check
      let isCodeValid = false; // full access flag
      
      // If at least one passcode is configured on the event
      if (dbPasscode || dbPartialPasscode) {
        if (!code) {
          if (!guest) {
            return reply.code(400).send({ error: 'Passcode is required to access this gallery' });
          }
        } else {
          const cleanCode = code.trim().toLowerCase();
          const cleanFull = dbPasscode ? dbPasscode.trim().toLowerCase() : null;
          const cleanPartial = dbPartialPasscode ? dbPartialPasscode.trim().toLowerCase() : null;

          if (cleanFull && cleanCode === cleanFull) {
            isCodeValid = true; // Full access granted
          } else if (cleanPartial && cleanCode === cleanPartial) {
            isCodeValid = false; // Partial access granted
          } else {
            if (!guest) {
              return reply.code(400).send({ error: 'Invalid passcode' });
            }
          }
        }
      }

      if (!guest) {
        guest = await prisma.guest.create({
          data: {
            eventId: event.id,
            email: decoded.email,
            name: user.name,
            phoneNumber: user.phoneNumber,
            provider: user.provider,
            providerId: user.providerId,
            hasFullAccess: isCodeValid
          }
        });
      } else {
        // If code is valid, upgrade access. Never downgrade.
        if (isCodeValid && !guest.hasFullAccess) {
          guest = await prisma.guest.update({
            where: { id: guest.id },
            data: { hasFullAccess: true }
          });
        }
      }

      await ensureUserSelfieMigrated(user.id, decoded.email);
      const hasSelfie = checkUserSelfie(user.id);

      // Generate secure guest JWT session
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
          hasSelfie
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

      // Verify the passcode
      let resolvedProjectId = event.projectId;
      if (!resolvedProjectId && event.leadId) {
        const projRes = await pool.query(
          `SELECT id FROM projects WHERE lead_id = $1 LIMIT 1`,
          [event.leadId]
        );
        if (projRes.rows.length) {
          resolvedProjectId = projRes.rows[0].id;
        }
      }

      let isCodeValid = false;
      if (resolvedProjectId) {
        const passRes = await pool.query(
          `SELECT passcode FROM projects WHERE id::text = $1 LIMIT 1`,
          [String(resolvedProjectId)]
        );
        if (passRes.rows.length) {
          const dbPasscode = passRes.rows[0].passcode;
          if (dbPasscode && code.trim().toLowerCase() === dbPasscode.trim().toLowerCase()) {
            isCodeValid = true;
          }
        }
      }

      if (!isCodeValid) {
        return reply.code(400).send({ error: 'Invalid passcode' });
      }

      // Update the guest status in the database — only upgrade, never downgrade
      const guestId = req.guest.guestId;
      const updatedGuest = await prisma.guest.update({
        where: { id: guestId },
        data: { hasFullAccess: true }
      });

      // Generate a new secure JWT session token with upgraded permissions
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
          hasSelfie: checkUserSelfie(req.guest.userId)
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to upgrade access level' });
    }
  });

  // Store/update guest phone number (Mandatory, post-login collection)
  fastify.post('/api/gallery/public/events/:slug/phone', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return reply.code(400).send({ error: 'Phone number is required' });

    try {
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

  // Guest upload and save verification selfie permanently
  fastify.post('/api/gallery/public/events/:slug/selfie', { preHandler: verifyGuestAuth, bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    const eventId = req.guest.eventId;
    const guestKey = `${req.guest.email}_${eventId}`;
    const userId = req.guest.userId;

    try {
      const data = await req.file();
      if (!data) return reply.code(400).send({ error: 'No image uploaded' });

      const buffer = await data.toBuffer();
      
      const selfiesDir = path.join(__dirname, '..', 'uploads', 'photos', 'selfies');
      fs.mkdirSync(selfiesDir, { recursive: true });

      const selfiePath = path.join(selfiesDir, `user_${userId}.jpg`);
      const vectorPath = path.join(selfiesDir, `user_${userId}.json`);

      fs.writeFileSync(selfiePath, buffer);

      // Validate selfie face and extract vector
      try {
        const res = await faceRecManager.validateSelfie(selfiePath);

        if (res.success && res.vector) {
          fs.writeFileSync(vectorPath, JSON.stringify(res.vector), 'utf8');

          // Cache in memory
          guestAnchors[guestKey] = {
            anchorVector: res.vector,
            extraVectors: []
          };

          return { status: 'success' };
        } else {
          // Validation failed (User error: e.g. no face detected), clean up the saved image file
          if (fs.existsSync(selfiePath)) fs.unlinkSync(selfiePath);
          return reply.code(400).send({ error: res.error || 'Failed to validate face on selfie' });
        }
      } catch (extractErr) {
        req.log.error('Face validation script execution failed:', extractErr.message);
        // Do NOT delete the selfie file. Save it for later processing/verification on-the-fly!
        return { status: 'success', warning: 'processing' };
      }
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to upload selfie' });
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

      const selfiePath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `user_${userId}.jpg`);
      const vectorPath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `user_${userId}.json`);

      if (!fs.existsSync(selfiePath)) {
        return { photos: [] }; // No selfie captured yet
      }

      // Check if we need to load anchor vector into memory
      if (!guestAnchors[guestKey] || !guestAnchors[guestKey].anchorVector) {
        if (fs.existsSync(vectorPath)) {
          const vector = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));
          guestAnchors[guestKey] = {
            anchorVector: vector,
            extraVectors: []
          };
        } else {
          // Fallback: extract it if vector JSON is missing but image exists
          try {
            const res = await faceRecManager.validateSelfie(selfiePath);
            if (res.success && res.vector) {
              fs.writeFileSync(vectorPath, JSON.stringify(res.vector), 'utf8');
              guestAnchors[guestKey] = {
                anchorVector: res.vector,
                extraVectors: []
              };
            } else {
              return reply.code(400).send({ error: 'Face could not be parsed from saved selfie' });
            }
          } catch (extractErr) {
            req.log.error('Fallback face extraction failed:', extractErr.message);
            return reply.code(500).send({ error: 'Failed to process saved selfie' });
          }
        }
      }

      const anchorVector = guestAnchors[guestKey].anchorVector;
      const extraVectors = guestAnchors[guestKey].extraVectors || [];

      // Find all event photo IDs
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
          const { execSync } = require('child_process');
          try {
            const res = await faceRecManager.matchSelfie(selfiePath, dbVectors, extraVectors);
            if (res.matches) {
              photoIds = res.matches.map(m => m.photoId);
            }
          } catch (matchErr) {
            req.log.error('Match execution failed for saved selfie:', matchErr.message);
          }
        }
      } else {
        // Query matching vectors directly from Qdrant!
        const mainMatches = await qdrant.searchVectors(eventId, anchorVector, 100, 0.35);
        const photoIdsSet = new Set(mainMatches.map(m => m.photo_id));
        
        for (const extraVec of extraVectors) {
          const extraMatches = await qdrant.searchVectors(eventId, extraVec, 100, 0.35);
          extraMatches.forEach(m => photoIdsSet.add(m.photo_id));
        }
        photoIds = Array.from(photoIdsSet);
      }

      // Fallback for dev mode
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

      // Save matches count to Guest table for analytics
      try {
        await prisma.guest.update({
          where: { id: guestId },
          data: { matchCount: mappedPhotos.length }
        });
      } catch (dbErr) {
        req.log.error('Failed to update guest matchCount:', dbErr.message);
      }

      return { photos: mappedPhotos };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to fetch matched photos' });
    }
  });

  // Stream matched photos of the guest as a ZIP file
  fastify.get('/api/gallery/public/events/:slug/download-my-photos', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const eventId = req.guest.eventId;
    const guestKey = `${req.guest.email}_${eventId}`;
    const userId = req.guest.userId;
    const guestId = req.guest.guestId;

    try {
      const event = req.event || await prisma.galleryEvent.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: 'Event not found' });

      if (event.allowDownloads === false) {
        return reply.code(403).send({ error: 'Downloads are disabled for this gallery' });
      }

      const selfiePath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `user_${userId}.jpg`);
      const vectorPath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `user_${userId}.json`);

      if (!fs.existsSync(selfiePath)) {
        return reply.code(400).send({ error: 'No selfie captured yet' });
      }

      // Check if we need to load anchor vector into memory
      if (!guestAnchors[guestKey] || !guestAnchors[guestKey].anchorVector) {
        if (fs.existsSync(vectorPath)) {
          const vector = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));
          guestAnchors[guestKey] = {
            anchorVector: vector,
            extraVectors: []
          };
        } else {
          // Fallback: extract it if vector JSON is missing but image exists
          try {
            const res = await faceRecManager.validateSelfie(selfiePath);
            if (res.success && res.vector) {
              fs.writeFileSync(vectorPath, JSON.stringify(res.vector), 'utf8');
              guestAnchors[guestKey] = {
                anchorVector: res.vector,
                extraVectors: []
              };
            } else {
              return reply.code(400).send({ error: 'Face could not be parsed from saved selfie' });
            }
          } catch (extractErr) {
            req.log.error('Fallback face extraction failed:', extractErr.message);
            return reply.code(500).send({ error: 'Failed to process saved selfie' });
          }
        }
      }

      const anchorVector = guestAnchors[guestKey].anchorVector;
      const extraVectors = guestAnchors[guestKey].extraVectors || [];

      // Find all event photo IDs
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
            const res = await faceRecManager.matchSelfie(selfiePath, dbVectors, extraVectors);
            if (res.matches) {
              photoIds = res.matches.map(m => m.photoId);
            }
          } catch (matchErr) {
            req.log.error('Match execution failed for saved selfie:', matchErr.message);
          }
        }
      } else {
        // Query matching vectors directly from Qdrant!
        const mainMatches = await qdrant.searchVectors(eventId, anchorVector, 100, 0.35);
        const photoIdsSet = new Set(mainMatches.map(m => m.photo_id));
        
        for (const extraVec of extraVectors) {
          const extraMatches = await qdrant.searchVectors(eventId, extraVec, 100, 0.35);
          extraMatches.forEach(m => photoIdsSet.add(m.photo_id));
        }
        photoIds = Array.from(photoIdsSet);
      }

      // Fallback for dev mode
      if (photoIds.length === 0 && (process.env.NODE_ENV === 'development' || process.env.MOCK_AI === 'true')) {
        const fallbackPhotos = await prisma.photo.findMany({
          where: { eventId },
          take: 3
        });
        photoIds = fallbackPhotos.map(p => p.id);
      }

      const photos = await prisma.photo.findMany({
        where: { id: { in: photoIds } }
      });

      if (photos.length === 0) {
        return reply.code(400).send({ error: 'No matched photos found' });
      }

      // Increment downloadCount of the guest
      try {
        await prisma.guest.update({
          where: { id: guestId },
          data: { downloadCount: { increment: photos.length } }
        });
      } catch (dbErr) {
        req.log.error('Failed to update guest downloadCount in download-my-photos:', dbErr.message);
      }

      const archiver = getArchiver();
      const { getObjectStream } = require('../utils/r2');

      reply.header('Content-Type', 'application/zip');
      const formattedTitle = event.title.replace(/\s+/g, '_');
      const guestName = (req.guest.name || 'guest').replace(/\s+/g, '_');
      reply.header('Content-Disposition', `attachment; filename="${formattedTitle}_${guestName}_matched_photos.zip"`);

      const archive = archiver('zip', {
        zlib: { level: 9 }
      });

      // Append files and finalize in the background, returning the stream directly to Fastify
      (async () => {
        try {
          for (const photo of photos) {
            let key = '';
            try {
              const parsed = new URL(photo.r2Url);
              key = decodeURIComponent(parsed.pathname.substring(1));
            } catch (e) {
              key = decodeURIComponent(photo.r2Url.replace(/^\/?api\/photos\/file\//, ''));
            }

            if (key) {
              try {
                const fileStream = await getObjectStream(key);
                // Segregate by tabName inside user's matched photos zip archive as well
                const folderName = photo.tabName ? `${photo.tabName}/` : '';
                archive.append(fileStream, { name: `${folderName}${photo.filename || path.basename(key)}` });
              } catch (err) {
                req.log.error(`Failed to append file ${key} to zip:`, err);
              }
            }
          }
          await archive.finalize();
        } catch (archiveErr) {
          req.log.error('Error during archive generation:', archiveErr);
          archive.destroy(archiveErr);
        }
      })();

      reply.send(archive);
      return reply;
    } catch (err) {
      req.log.error(err);
      reply.header('Content-Type', 'application/json');
      return reply.code(500).send({ error: 'Failed to generate matched photos archive' });
    }
  });

  fastify.post('/api/gallery/public/events/:slug/search', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const eventId = req.guest.eventId;
    const guestKey = `${req.guest.email}_${eventId}`;
    const guestId = req.guest.guestId;
    
    // Parse uploaded image using fastify-multipart
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No image uploaded' });

    try {
      const buffer = await data.toBuffer();
      
      // Save selfie temporarily to run face recognition
      const tempSelfiePath = path.join(__dirname, '..', 'db', `temp_selfie_${Date.now()}.jpg`);
      fs.writeFileSync(tempSelfiePath, buffer);

      let tempDbJsonPath = '';
      let tempExtraJsonPath = '';
      let photoIds = [];

      try {
        // Fetch pre-extracted face vectors for this event
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
            // Fetch extra vectors for query matching if present
            const extraVectors = guestAnchors[guestKey] ? guestAnchors[guestKey].extraVectors : [];
            const res = await faceRecManager.matchSelfie(tempSelfiePath, dbVectors, extraVectors);
            
            // Update in-memory anchor vector
            if (res.selfie_vector) {
              if (!guestAnchors[guestKey]) {
                guestAnchors[guestKey] = {
                  anchorVector: res.selfie_vector,
                  extraVectors: []
                };
              }
            }

            if (res.matches) {
              photoIds = res.matches.map(m => m.photoId);
              req.log.info(`Real SFace matching found ${photoIds.length} photos.`);
              
              // Log search telemetry details
              logTelemetry({
                eventId,
                guestEmail: req.guest.email,
                actionType: 'selfie_search',
                queryExpanded: res.query_expanded || false,
                seeds: res.seeds || [],
                matchesCount: photoIds.length,
                highestScore: res.matches.length > 0 ? res.matches[0].score : null
              });
            } else if (res.error) {
              req.log.error(`FaceRec script error: ${res.error}`);
            }
          }
        } else {
          // Query Qdrant directly!
          // Extract vector from uploaded selfie
          const res = await faceRecManager.validateSelfie(tempSelfiePath);
          
          if (res.success && res.vector) {
            // Update in-memory anchor vector
            if (!guestAnchors[guestKey]) {
              guestAnchors[guestKey] = {
                anchorVector: res.vector,
                extraVectors: []
              };
            }

            const extraVectors = guestAnchors[guestKey].extraVectors || [];
            const mainMatches = await qdrant.searchVectors(eventId, res.vector, 100, 0.35);
            const photoIdsSet = new Set(mainMatches.map(m => m.photo_id));
            
            for (const extraVec of extraVectors) {
              const extraMatches = await qdrant.searchVectors(eventId, extraVec, 100, 0.35);
              extraMatches.forEach(m => photoIdsSet.add(m.photo_id));
            }
            photoIds = Array.from(photoIdsSet);

            // Log search telemetry details
            logTelemetry({
              eventId,
              guestEmail: req.guest.email,
              actionType: 'selfie_search',
              queryExpanded: 'qdrant',
              seeds: [],
              matchesCount: photoIds.length,
              highestScore: mainMatches.length > 0 ? mainMatches[0].score : null
            });
          } else if (res.error) {
            req.log.error(`Selfie validation error: ${res.error}`);
          }
        }
      } catch (err) {
        req.log.error('Real face matching failed, falling back to mock query:', err.message);
      } finally {
        // Cleanup all temp files
        if (tempDbJsonPath && fs.existsSync(tempDbJsonPath)) {
          try { fs.unlinkSync(tempDbJsonPath); } catch (e) {}
        }
        if (tempExtraJsonPath && fs.existsSync(tempExtraJsonPath)) {
          try { fs.unlinkSync(tempExtraJsonPath); } catch (e) {}
        }
        if (fs.existsSync(tempSelfiePath)) {
          try { fs.unlinkSync(tempSelfiePath); } catch (e) {}
        }
      }

      // Fallback: If no real matches found or extraction failed, return a random photo subset in dev mode
      if (photoIds.length === 0 && (process.env.NODE_ENV === 'development' || process.env.MOCK_AI === 'true')) {
        const fallbackPhotos = await prisma.photo.findMany({
          where: { eventId },
          take: 3
        });
        photoIds = fallbackPhotos.map(p => p.id);
      }

      // Fetch matching photo urls from PostgreSQL
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
        likeCount: p._count?.likes || 0,
        isLiked: p.likes && p.likes.length > 0
      }));

      return { photos: mappedPhotos };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to execute facial search' });
    }
  });

  // Guest upload verification selfie (Option B)
  fastify.post('/api/gallery/public/events/:slug/verify-anchor', { preHandler: verifyGuestAuth }, async (req, reply) => {
    const eventId = req.guest.eventId;
    const guestKey = `${req.guest.email}_${eventId}`;
    
    // Check if the user has an anchor vector registered
    if (!guestAnchors[guestKey] || !guestAnchors[guestKey].anchorVector) {
      return reply.code(400).send({ error: 'No registered anchor selfie found. Please run a main search first.' });
    }

    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No image uploaded' });

    try {
      const buffer = await data.toBuffer();
      const tempSelfiePath = path.join(__dirname, '..', 'db', `temp_verify_${Date.now()}.jpg`);
      fs.writeFileSync(tempSelfiePath, buffer);

      try {
        const anchorVector = guestAnchors[guestKey].anchorVector;
        const res = await faceRecManager.verifyAnchor(tempSelfiePath, anchorVector);

        if (res.verified) {
          // Push this verified vector as an extra seed for future query matches
          guestAnchors[guestKey].extraVectors.push(res.vector);
          
          logTelemetry({
            eventId,
            guestEmail: req.guest.email,
            actionType: 'verify_anchor_success',
            score: res.score
          });

          return { verified: true, score: res.score };
        } else {
          logTelemetry({
            eventId,
            guestEmail: req.guest.email,
            actionType: 'verify_anchor_fail',
            score: res.score,
            error: res.error
          });

          return reply.code(400).send({ error: res.error });
        }
      } finally {
        if (fs.existsSync(tempSelfiePath)) fs.unlinkSync(tempSelfiePath);
      }
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to verify face signature' });
    }
  });
  // Middleware to verify global family token
  async function verifyFamilyAuth(req, reply) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Missing or invalid token' });
      }
      const token = authHeader.split(' ')[1];
      const decoded = fastify.jwt.verify(token);
      if (decoded.role !== 'family') {
        return reply.code(403).send({ error: 'Access denied' });
      }
      req.family = decoded;
    } catch (err) {
      return reply.code(401).send({ error: 'Unauthorized session' });
    }
  }

  // Verify OAuth Google token globally for Family Dashboard
  fastify.post('/api/gallery/family/auth', async (req, reply) => {
    const { token } = req.body;
    if (!token) return reply.code(400).send({ error: 'Google Token is required' });

    try {
      const verifyResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
      if (!verifyResponse.ok) {
        return reply.code(400).send({ error: 'Invalid Google token' });
      }
      const ticket = await verifyResponse.json();
      const verifiedEmail = ticket.email;
      const verifiedName = ticket.name || ticket.given_name;

      // Find or create global user profile
      let user = await prisma.circleUser.findUnique({
        where: { email: verifiedEmail }
      });

      if (!user) {
        user = await prisma.circleUser.create({
          data: {
            email: verifiedEmail,
            name: verifiedName,
            provider: 'google',
            providerId: ticket.sub || 'global'
          }
        });
      }

      // Generate a global family token containing global userId
      const familyToken = fastify.jwt.sign({
        email: verifiedEmail,
        role: 'family',
        name: user.name || verifiedName,
        userId: user.id
      }, { expiresIn: '7d' });

      return {
        token: familyToken,
        profile: {
          name: user.name || verifiedName,
          email: verifiedEmail,
          phoneNumber: user.phoneNumber,
          hasSelfie: checkUserSelfie(user.id),
          selfieGuestId: user.id
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Global authentication failed' });
    }
  });

  // Exchange an existing event guest JWT for a family JWT (auto-login from slug page session)
  fastify.post('/api/gallery/family/auth-from-event', async (req, reply) => {
    const { eventToken } = req.body;
    if (!eventToken) return reply.code(400).send({ error: 'Event token is required' });

    try {
      // Verify the existing event guest token
      let decoded;
      try {
        decoded = fastify.jwt.verify(eventToken);
      } catch (e) {
        return reply.code(401).send({ error: 'Invalid or expired event token' });
      }

      if (decoded.role !== 'guest' || !decoded.email) {
        return reply.code(403).send({ error: 'Invalid token role' });
      }

      const { email, guestId } = decoded;

      // Fetch guest info from DB to get name
      const guest = await prisma.guest.findUnique({ where: { id: guestId } });
      if (!guest) return reply.code(404).send({ error: 'Guest not found' });

      // Find or create global user profile
      let user = await prisma.circleUser.findUnique({
        where: { email }
      });
      if (!user) {
        user = await prisma.circleUser.create({
          data: {
            email,
            name: guest.name,
            phoneNumber: guest.phoneNumber,
            provider: guest.provider || 'google',
            providerId: guest.providerId || 'global'
          }
        });
      }

      await ensureUserSelfieMigrated(user.id, email);
      const hasSelfie = checkUserSelfie(user.id);

      // Generate a global family token containing global userId
      const familyToken = fastify.jwt.sign({
        email,
        role: 'family',
        name: guest.name,
        userId: user.id
      }, { expiresIn: '7d' });

      return {
        token: familyToken,
        profile: {
          name: guest.name,
          email,
          phoneNumber: guest.phoneNumber,
          hasSelfie,
          selfieGuestId: user.id
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Token exchange failed' });
    }
  });

  // Get all events linked to the family guest account
  fastify.get('/api/gallery/family/events', { preHandler: verifyFamilyAuth }, async (req, reply) => {
    const email = req.family.email;

    try {
      // Find global user profile
      const user = await prisma.circleUser.findUnique({
        where: { email }
      });
      if (!user) return { events: [], profile: null };

      const guestProfiles = await prisma.guest.findMany({
        where: { email },
        include: { galleryEvent: true }
      });

      const eventsList = [];
      const selfiesDir = path.join(__dirname, '..', 'uploads', 'photos', 'selfies');
      const selfiePath = path.join(selfiesDir, `user_${user.id}.jpg`);
      const vectorPath = path.join(selfiesDir, `user_${user.id}.json`);
      let anchorVector = null;

      if (fs.existsSync(selfiePath) && fs.existsSync(vectorPath)) {
        try {
          anchorVector = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));
        } catch (e) {
          req.log.error('Failed to parse anchor vector:', e);
        }
      }

      for (const g of guestProfiles) {
        const event = g.galleryEvent;
        if (!event || event.slug === 'system-directory') continue;

        let matchedCount = 0;

        if (anchorVector) {
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
          }

          if (dbVectors.length > 0) {
            try {
              const res = await faceRecManager.matchSelfie(selfiePath, dbVectors, []);
              if (res.matches) {
                matchedCount = res.matches.length;
              }
            } catch (matchErr) {
              req.log.error(`Match execution failed for event ${event.id}:`, matchErr.message);
            }
          }
        }

        const eventToken = fastify.jwt.sign({
          guestId: g.id,
          userId: user.id,
          eventId: event.id,
          email: g.email,
          role: 'guest',
          hasFullAccess: g.hasFullAccess
        }, { expiresIn: '7d' });

        eventsList.push({
          id: event.id,
          title: event.title,
          slug: event.slug,
          date: event.date,
          coverPhotoUrl: event.coverPhotoUrl,
          coverPhotoMobileUrl: event.coverPhotoMobileUrl,
          matchedCount,
          eventToken,
          guestInfo: {
            id: g.id,
            name: user.name || g.name,
            email: g.email,
            phoneNumber: user.phoneNumber,
            hasFullAccess: g.hasFullAccess,
            hasSelfie: !!anchorVector
          }
        });
      }

      return {
        events: eventsList,
        selfieUrl: checkUserSelfie(user.id) ? `/api/gallery/family/selfie/${user.id}` : null,
        profile: {
          name: user.name,
          email,
          phoneNumber: user.phoneNumber,
          hasSelfie: checkUserSelfie(user.id),
          selfieGuestId: user.id
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to fetch family events' });
    }
  });

  // Helper function to update guest details (name, phone) and optionally verify & replicate a new selfie globally
  async function updateGuestProfileGlobal(email, name, phoneNumber, selfieBuffer, log) {
    // Find or create global user profile
    let user = await prisma.circleUser.findUnique({
      where: { email }
    });

    if (!user) {
      user = await prisma.circleUser.create({
        data: {
          email,
          name: name || undefined,
          phoneNumber: phoneNumber || undefined
        }
      });
    } else {
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;

      if (Object.keys(updateData).length > 0) {
        user = await prisma.circleUser.update({
          where: { email },
          data: updateData
        });
      }
    }

    // Legacy fallback: Sync details into pre-existing event Guest records
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;

    if (Object.keys(updateData).length > 0) {
      await prisma.guest.updateMany({
        where: { email },
        data: updateData
      });
    }

    let hasSelfie = checkUserSelfie(user.id);

    // Handle selfie verification if buffer is provided
    if (selfieBuffer) {
      const selfiesDir = path.join(__dirname, '..', 'uploads', 'photos', 'selfies');
      fs.mkdirSync(selfiesDir, { recursive: true });

      const tempPath = path.join(selfiesDir, `temp_profile_verify_${Date.now()}.jpg`);
      fs.writeFileSync(tempPath, selfieBuffer);

      try {
        const res = await faceRecManager.validateSelfie(tempPath);

        if (res.success && res.vector) {
          const selfiePath = path.join(selfiesDir, `user_${user.id}.jpg`);
          const vectorPath = path.join(selfiesDir, `user_${user.id}.json`);

          fs.writeFileSync(selfiePath, selfieBuffer);
          fs.writeFileSync(vectorPath, JSON.stringify(res.vector), 'utf8');

          // Cache vectors in memory for matching
          const guestProfiles = await prisma.guest.findMany({
            where: { email }
          });

          for (const g of guestProfiles) {
            const guestKey = `${email}_${g.eventId}`;
            guestAnchors[guestKey] = {
              anchorVector: res.vector,
              extraVectors: []
            };

            // Force event dirty state to trigger re-clustering
            await prisma.galleryEvent.update({
              where: { id: g.eventId },
              data: { clustersDirty: true }
            }).catch(() => {});
          }

          hasSelfie = true;
        } else {
          throw new Error(res.error || 'Failed to validate face on selfie');
        }
      } catch (err) {
        log.error('Face validation failed: ' + err.message);
        throw new Error(err.message || 'Failed to run facial verification');
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    }

    return {
      name: user.name,
      email,
      phoneNumber: user.phoneNumber,
      hasSelfie,
      selfieGuestId: user.id
    };
  }

  // Parses multipart fields and files
  async function parseProfileUpdateParams(req) {
    let name = undefined;
    let phoneNumber = undefined;
    let selfieBuffer = null;

    if (req.isMultipart()) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.file) {
          selfieBuffer = await part.toBuffer();
        } else {
          if (part.fieldname === 'name') name = part.value;
          if (part.fieldname === 'phoneNumber') phoneNumber = part.value;
        }
      }
    } else {
      name = req.body?.name;
      phoneNumber = req.body?.phoneNumber;
    }

    return { name, phoneNumber, selfieBuffer };
  }

  // Update profile from Circle dashboard
  fastify.post('/api/gallery/family/profile/update', { preHandler: verifyFamilyAuth }, async (req, reply) => {
    try {
      const { name, phoneNumber, selfieBuffer } = await parseProfileUpdateParams(req);
      const profile = await updateGuestProfileGlobal(req.family.email, name, phoneNumber, selfieBuffer, req.log);
      return { success: true, profile };
    } catch (err) {
      req.log.error(err);
      return reply.code(400).send({ error: err.message || 'Failed to update profile' });
    }
  });

  // Update profile from public gallery event page
  fastify.post('/api/gallery/public/events/:slug/profile/update', { preHandler: verifyGuestAuth }, async (req, reply) => {
    try {
      const { name, phoneNumber, selfieBuffer } = await parseProfileUpdateParams(req);
      const profile = await updateGuestProfileGlobal(req.guest.email, name, phoneNumber, selfieBuffer, req.log);
      return { success: true, profile };
    } catch (err) {
      req.log.error(err);
      return reply.code(400).send({ error: err.message || 'Failed to update profile' });
    }
  });

  // Get current guest profile details
  fastify.get('/api/gallery/public/events/:slug/profile', { preHandler: verifyGuestAuth }, async (req, reply) => {
    try {
      const guest = await prisma.guest.findUnique({
        where: { id: req.guest.guestId }
      });
      if (!guest) return reply.code(404).send({ error: 'Guest not found' });

      // Find or create global user profile
      let user = await prisma.circleUser.findUnique({
        where: { email: guest.email }
      });

      if (!user) {
        user = await prisma.circleUser.create({
          data: {
            email: guest.email,
            name: guest.name,
            phoneNumber: guest.phoneNumber,
            provider: guest.provider,
            providerId: guest.providerId
          }
        });
      }

      return {
        profile: {
          id: guest.id,
          name: user.name || guest.name,
          email: guest.email,
          phoneNumber: user.phoneNumber,
          hasFullAccess: guest.hasFullAccess,
          hasSelfie: checkUserSelfie(user.id),
          selfieGuestId: user.id
        }
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to fetch guest profile' });
    }
  });

  // Get guest selfie file
  fastify.get('/api/gallery/family/selfie/:guestId', async (req, reply) => {
    const guestId = parseInt(req.params.guestId);
    if (isNaN(guestId)) return reply.code(400).send({ error: 'Invalid user ID' });

    // Admin Preview dummy guestId check
    if (guestId === 999999) {
      return reply.code(404).send({ error: 'Selfie not found' });
    }

    // Require auth: guest JWT, family/circle JWT, admin cookie, or system HMAC signature
    let authedEmail = null;
    let isAdmin = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      let signatureVerified = false;
      try {
        const parts = token.split('.');
        if (parts.length === 2) {
          const payloadStr = Buffer.from(parts[0], 'base64url').toString('utf8');
          const signature = parts[1];
          const sharedSecret = crypto.createHash('sha256').update(process.env.DATABASE_URL || 'fallback-secret-key').digest('hex');
          const expectedSig = crypto.createHmac('sha256', sharedSecret).update(payloadStr).digest('hex');
          if (signature === expectedSig) {
            const payload = JSON.parse(payloadStr);
            if (Math.abs(Date.now() - payload.timestamp) < 300000 && payload.guestId === guestId) {
              isAdmin = true;
              signatureVerified = true;
            }
          }
        }
      } catch (err) {
        req.log.warn(`HMAC validation error: ${err.message}`);
      }

      if (!signatureVerified) {
        try {
          const decoded = fastify.jwt.verify(token);
          if (decoded.role === 'guest' && decoded.email) {
            authedEmail = decoded.email;
          } else if (decoded.role === 'family' && decoded.email) {
            authedEmail = decoded.email;
          } else {
            return reply.code(403).send({ error: 'Access denied' });
          }
        } catch (err) {
          return reply.code(401).send({ error: 'Invalid or expired token' });
        }
      }
    } else {
      // Fallback: admin cookie
      const adminAuth = requireAdmin(req, reply);
      if (!adminAuth) return;
      isAdmin = true;
    }

    let resolvedUserId = guestId;

    // Non-admin users can only access their own selfie
    if (!isAdmin) {
      // Look up both potential matches to avoid ID collisions between guests and circleUsers
      const userById = await prisma.circleUser.findUnique({ where: { id: guestId } });
      
      const dbGuest = await prisma.guest.findUnique({ where: { id: guestId } });
      const userByGuest = dbGuest 
        ? await prisma.circleUser.findUnique({ where: { email: dbGuest.email } })
        : null;

      let matchedUser = null;
      if (userById && userById.email === authedEmail) {
        matchedUser = userById;
      } else if (userByGuest && userByGuest.email === authedEmail) {
        matchedUser = userByGuest;
      }

      if (!matchedUser) {
        return reply.code(403).send({ error: 'You can only view your own selfie' });
      }
      resolvedUserId = matchedUser.id;
    } else {
      // For admin, check Guest table first since the admin panel uses guest IDs.
      const dbGuest = await prisma.guest.findUnique({ where: { id: guestId } });
      if (dbGuest) {
        const linkedUser = await prisma.circleUser.findUnique({ where: { email: dbGuest.email } });
        if (linkedUser) {
          resolvedUserId = linkedUser.id;
        }
      } else {
        const user = await prisma.circleUser.findUnique({ where: { id: guestId } });
        if (user) resolvedUserId = user.id;
      }
    }

    let selfiePath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `user_${resolvedUserId}.jpg`);
    if (!fs.existsSync(selfiePath)) {
      // Fallback: check guest_${guestId}.jpg if user_${resolvedUserId}.jpg doesn't exist
      const fallbackPath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `guest_${guestId}.jpg`);
      if (fs.existsSync(fallbackPath)) {
        selfiePath = fallbackPath;
      } else {
        // Double-check: check guest_${resolvedUserId}.jpg just in case
        const fallbackResolvedPath = path.join(__dirname, '..', 'uploads', 'photos', 'selfies', `guest_${resolvedUserId}.jpg`);
        if (fs.existsSync(fallbackResolvedPath)) {
          selfiePath = fallbackResolvedPath;
        } else {
          return reply.code(404).send({ error: 'Selfie not found' });
        }
      }
    }
    reply.type('image/jpeg');
    return reply.send(fs.createReadStream(selfiePath));
  });

  // Proxy endpoint to force download files (works on both PC and mobile by setting Content-Disposition header)
  fastify.get('/api/gallery/public/download-proxy', async (req, reply) => {
    const { url, filename } = req.query;
    if (!url) return reply.code(400).send({ error: 'URL is required' });
    try {
      // Look up photo record to find which gallery event it belongs to
      const photo = await prisma.photo.findFirst({
        where: { r2Url: url },
        include: { galleryEvent: true }
      });

      if (photo && !photo.galleryEvent.allowDownloads) {
        return reply.code(403).send({ error: 'Downloads are disabled for this gallery' });
      }

      // Parse URL to prevent Server-Side Request Forgery (SSRF)
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.toLowerCase();

      // Block local, loopback, and private addresses
      const isLocal = 
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '[::1]' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('169.254.') || // AWS/Cloud Instance metadata endpoints
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname); // 172.16.x.x - 172.31.x.x range

      if (isLocal) {
        req.log.warn(`Blocked download-proxy request to local network/loopback target: ${url}`);
        return reply.code(400).send({ error: 'Invalid URL target' });
      }

      // Only allow HTTP/HTTPS protocols
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return reply.code(400).send({ error: 'Only HTTP and HTTPS protocols are allowed' });
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch file');

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="${filename || 'download.jpg'}"`);
      reply.header('Access-Control-Allow-Origin', '*');

      // Track download for analytics if guest token is present
      try {
        let guestToken = req.query.token;
        if (!guestToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
          guestToken = req.headers.authorization.split(' ')[1];
        }
        if (guestToken) {
          const decoded = fastify.jwt.verify(guestToken);
          if (decoded && decoded.guestId) {
            await prisma.guest.update({
              where: { id: decoded.guestId },
              data: { downloadCount: { increment: 1 } }
            });
          }
        }
      } catch (tokenErr) {
        // Silent error if token is invalid or expired
      }

      return reply.send(buffer);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to download file' });
    }
  });
  // Verify bulk download PIN route
  fastify.post('/api/gallery/public/events/:slug/verify-bulk-pin', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const { pin } = req.body || {};

    try {
      const event = await prisma.galleryEvent.findUnique({
        where: { slug },
        select: {
          active: true,
          allowBulkDownloads: true,
          bulkDownloadPin: true
        }
      });

      if (!event || !event.active) {
        return reply.code(404).send({ error: 'Gallery not found' });
      }

      if (!event.allowBulkDownloads) {
        return reply.code(403).send({ error: 'Bulk downloads are disabled for this gallery' });
      }

      if (event.bulkDownloadPin && event.bulkDownloadPin !== pin) {
        return reply.code(401).send({ error: 'Invalid bulk download PIN' });
      }

      return { success: true };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Server error verifying PIN' });
    }
  });

  // Bulk download streaming ZIP endpoint
  fastify.get('/api/gallery/public/events/:slug/bulk-download', async (req, reply) => {
    const slug = req.params.slug.toLowerCase().trim();
    const { pin } = req.query;

    try {
      const event = await prisma.galleryEvent.findUnique({
        where: { slug },
        select: {
          id: true,
          title: true,
          active: true,
          allowBulkDownloads: true,
          bulkDownloadPin: true
        }
      });

      if (!event || !event.active) {
        return reply.code(404).send({ error: 'Gallery not found' });
      }

      if (!event.allowBulkDownloads) {
        return reply.code(403).send({ error: 'Bulk downloads are disabled for this gallery' });
      }

      if (event.bulkDownloadPin && event.bulkDownloadPin !== pin) {
        return reply.code(401).send({ error: 'Invalid bulk download PIN' });
      }

      const photos = await prisma.photo.findMany({
        where: { eventId: event.id }
      });

      if (photos.length === 0) {
        return reply.code(400).send({ error: 'No photos found in this gallery' });
      }

      const archiver = getArchiver();
      const { getObjectStream } = require('../utils/r2');

      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${event.title.replace(/\s+/g, '_')}_photos.zip"`);

      const archive = archiver('zip', {
        zlib: { level: 9 }
      });

      // Append files and finalize in the background, returning the stream directly to Fastify
      (async () => {
        try {
          for (const photo of photos) {
            let key = '';
            try {
              const parsed = new URL(photo.r2Url);
              key = decodeURIComponent(parsed.pathname.substring(1));
            } catch (e) {
              key = decodeURIComponent(photo.r2Url.replace(/^\/?api\/photos\/file\//, ''));
            }

            if (key) {
              try {
                const fileStream = await getObjectStream(key);
                const folderName = photo.tabName ? `${photo.tabName}/` : 'General/';
                archive.append(fileStream, { name: `${folderName}${photo.filename || path.basename(key)}` });
              } catch (err) {
                req.log.error(`Failed to append file ${key} to zip:`, err);
              }
            }
          }
          await archive.finalize();
        } catch (archiveErr) {
          req.log.error('Error during bulk archive generation:', archiveErr);
          archive.destroy(archiveErr);
        }
      })();

      reply.send(archive);
      return reply;
    } catch (err) {
      req.log.error(err);
      reply.header('Content-Type', 'application/json');
      return reply.code(500).send({ error: 'Failed to generate bulk download archive' });
    }
  });
};
function purgeOrphanedFacesBackground(log) {
  setTimeout(() => {
    try {
      const qdrant = require('../utils/qdrant');
      const targetDir = path.join(__dirname, '..', 'uploads', 'photos');
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
