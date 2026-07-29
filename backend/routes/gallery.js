const fs = require('fs');
const path = require('path');
const { PHOTO_UPLOAD_DIR, getImageContentType } = require('./gallery/galleryCommon');

const adminGalleryRoutes = require('./gallery/adminGallery');
const publicGalleryRoutes = require('./gallery/publicGallery');
const guestAuthMatchingRoutes = require('./gallery/guestAuthMatching');
const familyRoutes = require('./gallery/familyRoutes');
const downloadRoutes = require('./gallery/downloadRoutes');

module.exports = async function galleryRoutes(fastify, opts) {
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
