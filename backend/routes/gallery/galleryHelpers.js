const fs = require('fs');
const path = require('path');
const { prisma } = require('../../prisma');
const qdrant = require('../../utils/qdrant');
const { deleteAsset } = require('../../utils/r2');

async function deletePhotosAssets(photos, slug, log) {
  const { isR2Enabled } = require('../../utils/r2');
  let publicDomain = '';
  if (isR2Enabled && process.env.R2_PUBLIC_DOMAIN_URL) {
    publicDomain = process.env.R2_PUBLIC_DOMAIN_URL.trim();
    if (publicDomain.startsWith('http://')) publicDomain = publicDomain.substring(7);
    if (publicDomain.startsWith('https://')) publicDomain = publicDomain.substring(8);
  }

  const chunkSize = 15;
  for (let i = 0; i < photos.length; i += chunkSize) {
    const chunk = photos.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (p) => {
      try {
        const faceIds = await qdrant.getFaceIdsForPhoto(p.id);
        await Promise.all(faceIds.map(async (faceId) => {
          if (isR2Enabled && publicDomain && slug) {
            const faceUrl = `https://${publicDomain}/events/${slug}/photos/${faceId}.jpg`;
            await deleteAsset(faceUrl).catch(() => {});
            const faceUrlAlt = `https://${publicDomain}/events/${slug}/faces/${faceId}.jpg`;
            await deleteAsset(faceUrlAlt).catch(() => {});
          } else {
            const targetDir = path.join(__dirname, '..', '..', 'uploads', 'photos');
            const localFacePath = path.join(targetDir, `${faceId}.jpg`);
            if (fs.existsSync(localFacePath)) {
              try { fs.unlinkSync(localFacePath); } catch (e) {}
            }
          }
        }));

        await qdrant.deleteVectorsForPhoto(p.id);

        if (p.thumbnailUrl) {
          await deleteAsset(p.thumbnailUrl).catch(() => {});
        } else if (isR2Enabled && publicDomain && slug && p.filename) {
          const thumbFilename = `thumb_${p.filename}`;
          const thumbSubfolder = `events/${slug}/thumbnails`;
          const thumbKey = `${thumbSubfolder}/${thumbFilename}`;
          const thumbUrl = `https://${publicDomain}/${thumbKey}`;
          await deleteAsset(thumbUrl).catch(() => {});
        }

        if (p.r2Url) {
          await deleteAsset(p.r2Url).catch(() => {});
        }

        if (p.filename) {
          const targetDir = path.join(__dirname, '..', '..', 'uploads', 'photos');
          const filePath = path.join(targetDir, p.filename);
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
          }

          const thumbPath = path.join(targetDir, `thumb_${p.filename}`);
          if (fs.existsSync(thumbPath)) {
            try { fs.unlinkSync(thumbPath); } catch (e) {}
          }

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

async function generateUniqueCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  while (true) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const existing = await prisma.galleryEvent.findFirst({
      where: {
        OR: [
          { fullCode: code },
          { partialCode: code }
        ]
      }
    });
    if (!existing) return code;
  }
}

module.exports = {
  deletePhotosAssets,
  generateUniqueCode,
};
