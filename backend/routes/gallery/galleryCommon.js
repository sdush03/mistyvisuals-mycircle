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
  const isVideo = (url) => {
    if (!url || typeof url !== 'string') return false;
    const clean = url.split('?')[0].toLowerCase();
    return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.webm');
  };

  // 1. If a valid image thumbnail already exists, use it directly (never route to resize)
  if (thumbnailUrl && !isVideo(thumbnailUrl) && !thumbnailUrl.startsWith('/api/gallery/resize')) {
    return thumbnailUrl;
  }

  // If r2Url is a video, never route to image resize service
  if (isVideo(r2Url)) {
    return null;
  }

  // 2. Derive direct pre-generated R2 thumbnail from standard /photos/ path so clients load straight from CDN
  if (r2Url && typeof r2Url === 'string' && r2Url.includes('/photos/')) {
    const clean = r2Url.split('?')[0];
    const fn = clean.substring(clean.lastIndexOf('/') + 1);
    return clean.replace('/photos/' + fn, `/thumbnails/thumb_${fn}`);
  }

  return thumbnailUrl || r2Url || null;
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

function isMobileAppRequest(req) {
  const appVer = req.headers['x-app-version'];
  if (appVer) return true;
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  return ua.includes('okhttp') || ua.includes('cfnetwork') || ua.includes('expo') || ua.includes('mycircle') || ua.includes('darwin') || ua.includes('reactnative') || !ua.includes('mozilla');
}

const guestAnchors = {};

const checkUserSelfie = async (userId) => {
  if (!userId) return false;
  try {
    const user = await prisma.circleUser.findUnique({
      where: { id: userId },
      select: { selfieUrl: true, selfieVector: true }
    });
    if (user?.selfieUrl || user?.selfieVector) return true;

    const selfiesDir = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies');
    if (fs.existsSync(path.join(selfiesDir, `user_${userId}.jpg`)) || fs.existsSync(path.join(selfiesDir, `user_${userId}.json`))) {
      return true;
    }
    return false;
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

const resolveAnchorVector = async ({ userId, email, guestId } = {}) => {
  let circleUser = null;
  if (userId) {
    circleUser = await prisma.circleUser.findUnique({
      where: { id: userId },
      select: { id: true, selfieVector: true, email: true }
    }).catch(() => null);
  }
  if (!circleUser && email) {
    circleUser = await prisma.circleUser.findUnique({
      where: { email },
      select: { id: true, selfieVector: true, email: true }
    }).catch(() => null);
  }

  if (circleUser?.selfieVector) {
    return circleUser.selfieVector;
  }

  const selfiesDir = path.join(__dirname, '..', '..', 'uploads', 'photos', 'selfies');
  const candidateIds = [circleUser?.id, userId, guestId].filter(Boolean);
  for (const cid of candidateIds) {
    const userVecFile = path.join(selfiesDir, `user_${cid}.json`);
    if (fs.existsSync(userVecFile)) {
      try {
        const v = JSON.parse(fs.readFileSync(userVecFile, 'utf8'));
        if (v && Array.isArray(v)) return v;
      } catch (_) {}
    }
    const guestVecFile = path.join(selfiesDir, `guest_${cid}.json`);
    if (fs.existsSync(guestVecFile)) {
      try {
        const v = JSON.parse(fs.readFileSync(guestVecFile, 'utf8'));
        if (v && Array.isArray(v)) return v;
      } catch (_) {}
    }
  }

  if (email) {
    try {
      const guests = await prisma.guest.findMany({ where: { email }, select: { id: true } });
      for (const g of guests) {
        const gVec = path.join(selfiesDir, `guest_${g.id}.json`);
        if (fs.existsSync(gVec)) {
          try {
            const v = JSON.parse(fs.readFileSync(gVec, 'utf8'));
            if (v && Array.isArray(v)) return v;
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  return null;
};

const { verifyGuestAuth, verifyFamilyAuth } = require('../../utils/galleryAuth');

module.exports = {
  PHOTO_UPLOAD_DIR,
  getImageContentType,
  getDerivedThumbnail,
  getArchiver,
  checkPreviewToken,
  isMobileAppRequest,
  guestAnchors,
  checkUserSelfie,
  ensureUserSelfieMigrated,
  resolveAnchorVector,
  logTelemetry,
  verifyGuestAuth,
  verifyFamilyAuth,
};

