const fs = require('fs');
const path = require('path');
const { prisma } = require('../../prisma');
const qdrant = require('../../utils/qdrant');
const faceRecManager = require('../../utils/faceRecManager');
const { guestAnchors, getArchiver, verifyGuestAuth } = require('./galleryCommon');

module.exports = async function downloadRoutes(fastify, opts) {

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

      const selfiePath = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies', `user_${userId}.jpg`);
      const vectorPath = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies', `user_${userId}.json`);

      if (!fs.existsSync(selfiePath)) {
        return reply.code(400).send({ error: 'No selfie captured yet' });
      }

      if (!guestAnchors[guestKey] || !guestAnchors[guestKey].anchorVector) {
        if (fs.existsSync(vectorPath)) {
          const vector = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));
          guestAnchors[guestKey] = {
            anchorVector: vector,
            extraVectors: []
          };
        } else {
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
        const mainMatches = await qdrant.searchVectors(eventId, anchorVector, 100000, 0.35);
        const photoIdsSet = new Set(mainMatches.map(m => m.photo_id));
        
        for (const extraVec of extraVectors) {
          const extraMatches = await qdrant.searchVectors(eventId, extraVec, 100000, 0.35);
          extraMatches.forEach(m => photoIdsSet.add(m.photo_id));
        }
        photoIds = Array.from(photoIdsSet);
      }

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

      try {
        await prisma.guest.update({
          where: { id: guestId },
          data: { downloadCount: { increment: photos.length } }
        });
      } catch (dbErr) {
        req.log.error('Failed to update guest downloadCount in download-my-photos:', dbErr.message);
      }

      const archiver = getArchiver();
      const { getObjectStream } = require('../../utils/r2');

      reply.header('Content-Type', 'application/zip');
      const formattedTitle = event.title.replace(/\s+/g, '_');
      const guestName = (req.guest.name || 'guest').replace(/\s+/g, '_');
      reply.header('Content-Disposition', `attachment; filename="${formattedTitle}_${guestName}_matched_photos.zip"`);

      const archive = archiver('zip', {
        zlib: { level: 9 }
      });

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

  // Proxy endpoint to force download files
  fastify.get('/api/gallery/public/download-proxy', async (req, reply) => {
    const { url, filename } = req.query;
    if (!url) return reply.code(400).send({ error: 'URL is required' });
    try {
      const filenameFromUrl = url.split('/').pop() || '';
      const photo = await prisma.photo.findFirst({
        where: {
          OR: [
            { r2Url: url },
            { url: url },
            { filename: filenameFromUrl },
            { r2Url: { endsWith: filenameFromUrl } }
          ]
        },
        include: { galleryEvent: true }
      });

      if (photo && !photo.galleryEvent.allowDownloads) {
        return reply.code(403).send({ error: 'Downloads are disabled for this gallery' });
      }

      let fetchUrl = url;
      if (url.startsWith('/')) {
        const host = req.headers.host || 'localhost:5001';
        const protocol = req.protocol || 'http';
        fetchUrl = `${protocol}://${host}${url}`;
      }

      const parsedUrl = new URL(fetchUrl);
      const hostname = parsedUrl.hostname.toLowerCase();

      const isDev = process.env.NODE_ENV === 'development';
      const isLocal = 
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '[::1]' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('169.254.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);

      if (isLocal && !isDev) {
        req.log.warn(`Blocked download-proxy request to local network/loopback target: ${url}`);
        return reply.code(400).send({ error: 'Invalid URL target' });
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return reply.code(400).send({ error: 'Only HTTP and HTTPS protocols are allowed' });
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error('Failed to fetch file');

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="${filename || 'download.jpg'}"`);
      reply.header('Access-Control-Allow-Origin', '*');

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
        // Silent error
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
      const { getObjectStream } = require('../../utils/r2');

      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${event.title.replace(/\s+/g, '_')}_photos.zip"`);

      const archive = archiver('zip', {
        zlib: { level: 9 }
      });

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
