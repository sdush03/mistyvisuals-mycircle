const fs = require('fs');
const path = require('path');
const { prisma } = require('../../prisma');

const PHOTO_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'photos');

function getImageContentType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
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

function checkPreviewToken(fastify, req) {
  try {
    const token = req.query.previewToken || req.headers['x-preview-token'] || (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') && req.headers.authorization.split(' ')[1]);
    if (!token) return null;
    const decoded = fastify.jwt.verify(token);
    if (decoded.isAdminPreview && req.params.slug && decoded.slug.toLowerCase().trim() === req.params.slug.toLowerCase().trim()) {
      return decoded;
    }
  } catch (e) {
    // invalid/expired token
  }
  return null;
}

const guestAnchors = {};

const checkUserSelfie = async (userId) => {
  if (!userId) return false;
  try {
    const user = await prisma.circleUser.findUnique({
      where: { id: userId },
      select: { selfieUrl: true }
    });
    return !!user?.selfieUrl;
  } catch (e) {
    return false;
  }
};

const ensureUserSelfieMigrated = async (fastify, userId, email) => {
  if (!userId || !email) return false;
  const newJpgPath = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies', `user_${userId}.jpg`);
  if (fs.existsSync(newJpgPath)) return true;

  try {
    const guests = await prisma.guest.findMany({ where: { email } });
    for (const guest of guests) {
      const oldJpgPath = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies', `guest_${guest.id}.jpg`);
      const oldJsonPath = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies', `guest_${guest.id}.json`);
      
      if (fs.existsSync(oldJpgPath)) {
        const newJsonPath = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies', `user_${userId}.json`);
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
  const telemetryPath = path.join(__dirname, '..', '..', 'db', 'telemetry.json');
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

const { verifyGuestAuth, verifyFamilyAuth } = require('../../utils/galleryAuth');

module.exports = {
  PHOTO_UPLOAD_DIR,
  getImageContentType,
  getDerivedThumbnail,
  getArchiver,
  checkPreviewToken,
  guestAnchors,
  checkUserSelfie,
  ensureUserSelfieMigrated,
  logTelemetry,
  verifyGuestAuth,
  verifyFamilyAuth,
};
