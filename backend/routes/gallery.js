const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const sharp = require('sharp');
const { PHOTO_UPLOAD_DIR, getImageContentType } = require('./gallery/galleryCommon');
const { isR2Enabled, getObjectStream } = require('../utils/r2');

const adminGalleryRoutes = require('./gallery/adminGallery');
const publicGalleryRoutes = require('./gallery/publicGallery');
const guestAuthMatchingRoutes = require('./gallery/guestAuthMatching');
const familyRoutes = require('./gallery/familyRoutes');
const downloadRoutes = require('./gallery/downloadRoutes');

module.exports = async function galleryRoutes(fastify, opts) {
  // On-The-Fly Image Resizing with Cloudflare Edge Cache Support
  // GET /api/gallery/resize?url=...&w=400&q=75
  fastify.get('/api/gallery/resize', async (req, reply) => {
    const imageUrl = req.query.url;
    const width = Math.min(Math.max(parseInt(req.query.w, 10) || 400, 50), 2000);
    const quality = Math.min(Math.max(parseInt(req.query.q, 10) || 75, 20), 100);

    if (!imageUrl || typeof imageUrl !== 'string') {
      return reply.code(400).send({ error: 'Missing url parameter' });
    }

    let inputStream = null;
    let key = '';

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      try {
        const parsed = new URL(imageUrl);
        key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      } catch (e) {
        key = imageUrl;
      }
    } else {
      key = decodeURIComponent(imageUrl.replace(/^\/?api\/photos\/file\//, '').replace(/^\/+/, ''));
    }

    try {
      // 1. Try reading directly from local disk or R2
      if (key) {
        try {
          const localPath = path.normalize(path.join(PHOTO_UPLOAD_DIR, key));
          if (fs.existsSync(localPath) && localPath.startsWith(PHOTO_UPLOAD_DIR)) {
            inputStream = fs.createReadStream(localPath);
          } else if (isR2Enabled) {
            // response.Body is a Web ReadableStream — must convert to Node.js stream for .pipe()
            const r2Body = await getObjectStream(key);
            inputStream = r2Body ? Readable.fromWeb(r2Body) : null;
          }
        } catch (r2Err) {
          fastify.log.debug(`[Resize] Direct stream lookup for "${key}" missed: ${r2Err.message}`);
        }
      }

      // 2. If direct key stream wasn't found, fetch over HTTP if full URL
      if (!inputStream && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        const fetchRes = await fetch(imageUrl);
        if (fetchRes.ok && fetchRes.body) {
          inputStream = Readable.fromWeb(fetchRes.body);
        }
      }

      if (!inputStream) {
        return reply.code(404).send({ error: 'Image source not found' });
      }

      const transformer = sharp()
        .rotate()
        .resize({
          width,
          withoutEnlargement: true,
        })
        .jpeg({
          quality,
          mozjpeg: true,
        });

      reply.type('image/jpeg');
      reply.header('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');

      return reply.send(inputStream.pipe(transformer));
    } catch (err) {
      fastify.log.warn(`[Resize Error] Failed to resize ${imageUrl}: ${err.message}`);
      if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        return reply.redirect(imageUrl);
      }
      return reply.code(500).send({ error: 'Image resize processing failed' });
    }
  });

  // File serving endpoint for gallery cover photos and matched event images
  fastify.get('/api/photos/file/*', async (req, reply) => {
    const relativePath = req.params['*'];
    if (!relativePath) return reply.code(404).send({ error: 'Not found' });
    const filePath = path.normalize(path.join(PHOTO_UPLOAD_DIR, relativePath));
    if (!filePath.startsWith(PHOTO_UPLOAD_DIR)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    try {
      await fs.promises.stat(filePath);
      reply.type(getImageContentType(path.basename(filePath)));
      return reply.send(fs.createReadStream(filePath));
    } catch (err) {
      const { isR2Enabled } = require('../utils/r2');
      if (isR2Enabled && process.env.R2_PUBLIC_DOMAIN_URL) {
        let publicDomain = process.env.R2_PUBLIC_DOMAIN_URL.trim();
        if (publicDomain.startsWith('http://')) publicDomain = publicDomain.substring(7);
        if (publicDomain.startsWith('https://')) publicDomain = publicDomain.substring(8);
        const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
        return reply.redirect(`https://${publicDomain}/${encodedPath}`);
      }
      return reply.code(404).send({ error: 'Not found' });
    }
  });

  // Register modular gallery sub-routers
  fastify.register(adminGalleryRoutes, opts);
  fastify.register(publicGalleryRoutes, opts);
  fastify.register(guestAuthMatchingRoutes, opts);
  fastify.register(familyRoutes, opts);
  fastify.register(downloadRoutes, opts);
};
