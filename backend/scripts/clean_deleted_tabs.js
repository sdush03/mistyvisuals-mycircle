/**
 * clean_deleted_tabs.js
 * Utility script to find and clean up database photo rows and associated R2/disk assets
 * for tabs that have already been deleted from the gallery_events tabs list.
 */
require('dotenv').config();
const { prisma } = require('../modules/quotation/prisma');
const qdrant = require('../utils/qdrant');
const { deleteAsset, isR2Enabled } = require('../utils/r2');
const path = require('path');
const fs = require('fs');

async function run() {
  console.log('Starting orphaned photos clean up...');
  
  // 1. Fetch all gallery events
  const events = await prisma.galleryEvent.findMany();
  let totalCleaned = 0;

  for (const event of events) {
    const slug = event.slug.toLowerCase().trim();
    console.log(`\nChecking event: "${event.title}" (Slug: ${slug})`);

    // 2. Fetch all photos for this event
    const photos = await prisma.photo.findMany({
      where: { eventId: event.id }
    });

    if (photos.length === 0) {
      console.log('  No photos uploaded.');
      continue;
    }

    // 3. Map active tabs for lookup
    const activeTabs = new Set((event.tabs || []).map(t => t.toLowerCase().trim()));
    // Always keep Highlights
    activeTabs.add('highlights');

    // 4. Identify photos with tabName NOT in activeTabs
    const photosToDelete = photos.filter(p => {
      if (!p.tabName) return false;
      const normalizedTab = p.tabName.toLowerCase().trim();
      return !activeTabs.has(normalizedTab);
    });

    if (photosToDelete.length === 0) {
      console.log('  ✓ No orphaned photos found.');
      continue;
    }

    console.log(`  Found ${photosToDelete.length} orphaned photos belonging to deleted tabs:`);
    photosToDelete.forEach(p => console.log(`    - [Photo ID: ${p.id}] ${p.filename} | Tab: "${p.tabName}"`));

    // 5. Delete assets in parallel chunks of 10
    console.log('  Deleting assets (R2, Qdrant, Local disk)...');
    
    let publicDomain = '';
    if (isR2Enabled && process.env.R2_PUBLIC_DOMAIN_URL) {
      publicDomain = process.env.R2_PUBLIC_DOMAIN_URL.trim();
      if (publicDomain.startsWith('http://')) publicDomain = publicDomain.substring(7);
      if (publicDomain.startsWith('https://')) publicDomain = publicDomain.substring(8);
    }

    const chunkSize = 10;
    for (let i = 0; i < photosToDelete.length; i += chunkSize) {
      const chunk = photosToDelete.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (p) => {
        try {
          // Face crops
          const faceIds = await qdrant.getFaceIdsForPhoto(p.id);
          await Promise.all(faceIds.map(async (faceId) => {
            if (isR2Enabled && publicDomain) {
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

          // Qdrant vectors
          await qdrant.deleteVectorsForPhoto(p.id);

          // Thumbnail
          if (p.thumbnailUrl) {
            await deleteAsset(p.thumbnailUrl).catch(() => {});
          } else if (isR2Enabled && publicDomain && p.filename) {
            const thumbFilename = `thumb_${p.filename}`;
            const thumbSubfolder = `events/${slug}/thumbnails`;
            const thumbKey = `${thumbSubfolder}/${thumbFilename}`;
            const thumbUrl = `https://${publicDomain}/${thumbKey}`;
            await deleteAsset(thumbUrl).catch(() => {});
          }

          // Main image
          if (p.r2Url) {
            await deleteAsset(p.r2Url).catch(() => {});
          }

          // Disk fallback
          if (p.filename) {
            const targetDir = path.join(__dirname, '..', 'uploads', 'photos');
            const filePath = path.join(targetDir, p.filename);
            if (fs.existsSync(filePath)) {
              try { fs.unlinkSync(filePath); } catch (e) {}
            }
            const thumbPath = path.join(targetDir, `thumb_${p.filename}`);
            if (fs.existsSync(thumbPath)) {
              try { fs.unlinkSync(thumbPath); } catch (e) {}
            }
          }
        } catch (err) {
          console.error(`  [Error] Failed to delete assets for photo ID ${p.id}:`, err.message);
        }
      }));
    }

    // 6. Delete DB records
    const ids = photosToDelete.map(p => p.id);
    await prisma.photo.deleteMany({
      where: { id: { in: ids } }
    });

    console.log(`  ✅ Cleaned up ${photosToDelete.length} photos from database.`);
    totalCleaned += photosToDelete.length;
  }

  console.log(`\nCleanup task completed. Total cleaned photos: ${totalCleaned}`);
  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error('Fatal cleanup error:', err);
  await prisma.$disconnect();
});
