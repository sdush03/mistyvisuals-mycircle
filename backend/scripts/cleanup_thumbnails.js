require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { prisma } = require('../prisma');
const { isR2Enabled } = require('../utils/r2');
const { PHOTO_UPLOAD_DIR } = require('../config/constants');

const isDryRun = process.argv.includes('--dry-run');
const includeFaces = process.argv.includes('--include-faces') || process.argv.includes('--all') || true; // enabled by default

async function cleanupThumbnailsAndFaces() {
  console.log('====================================================');
  console.log(`[R2 Asset Cleanup] Starting ${isDryRun ? 'DRY RUN' : 'CLEANUP'} (Thumbnails + Cropped Faces)...`);
  console.log('====================================================');

  let r2ThumbnailsCount = 0;
  let r2FacesCount = 0;
  let r2DeletedTotal = 0;
  let localDeletedCount = 0;

  // 1. Cloudflare R2 Bucket Cleanup
  if (isR2Enabled) {
    console.log('\n[1/3] Scanning Cloudflare R2 bucket for thumbnail & face crop objects under events/...');
    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      },
      region: 'auto'
    });

    let continuationToken = undefined;
    let totalScanned = 0;
    const keysToDelete = [];

    do {
      const listCmd = new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: 'events/',
        ContinuationToken: continuationToken
      });

      const listRes = await r2Client.send(listCmd);
      const objects = listRes.Contents || [];
      totalScanned += objects.length;

      for (const obj of objects) {
        if (!obj.Key) continue;
        const key = obj.Key;

        // Check for thumbnails
        if (key.includes('/thumbnails/') || path.basename(key).startsWith('thumb_')) {
          keysToDelete.push({ Key: key });
          r2ThumbnailsCount++;
        }
        // Check for face crops (under events/{slug}/faces/*) — NEVER touch users/selfies/
        else if (includeFaces && key.includes('/faces/')) {
          keysToDelete.push({ Key: key });
          r2FacesCount++;
        }
      }

      continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
      process.stdout.write(`\r  Scanned ${totalScanned} objects (found ${r2ThumbnailsCount} thumbnails, ${r2FacesCount} face crops)...`);
    } while (continuationToken);

    console.log(`\n  Total R2 objects identified to delete: ${keysToDelete.length} (${r2ThumbnailsCount} thumbnails, ${r2FacesCount} face crops)`);

    if (keysToDelete.length > 0) {
      if (isDryRun) {
        console.log(`  [DRY RUN] Would delete ${keysToDelete.length} objects from Cloudflare R2.`);
        r2DeletedTotal = keysToDelete.length;
      } else {
        console.log(`  Deleting ${keysToDelete.length} objects from R2 in batches of 1000...`);
        const BATCH_SIZE = 1000;
        for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
          const batch = keysToDelete.slice(i, i + BATCH_SIZE);
          const delCmd = new DeleteObjectsCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Delete: {
              Objects: batch,
              Quiet: true
            }
          });
          const delRes = await r2Client.send(delCmd);
          const errors = delRes.Errors || [];
          if (errors.length > 0) {
            console.warn(`  Warning: ${errors.length} objects failed to delete in batch ${Math.floor(i / BATCH_SIZE) + 1}`);
          }
          r2DeletedTotal += batch.length - errors.length;
          process.stdout.write(`\r  Deleted ${r2DeletedTotal}/${keysToDelete.length} objects from R2...`);
        }
        console.log(`\n  Successfully deleted ${r2DeletedTotal} objects from R2.`);
      }
    } else {
      console.log('  No thumbnail or face crop objects found in R2.');
    }
  } else {
    console.log('\n[1/3] R2 is not enabled in this environment. Skipping R2 bucket scan.');
  }

  // 2. Local Disk Cleanup (thumbnails & faces folders under events/)
  console.log('\n[2/3] Checking for local disk thumbnail & faces folders...');
  try {
    const eventsDir = path.join(PHOTO_UPLOAD_DIR, 'events');
    if (fs.existsSync(eventsDir)) {
      const eventFolders = fs.readdirSync(eventsDir);
      for (const eventFolder of eventFolders) {
        // Thumbnails folder
        const thumbDir = path.join(eventsDir, eventFolder, 'thumbnails');
        if (fs.existsSync(thumbDir)) {
          const files = fs.readdirSync(thumbDir);
          if (isDryRun) {
            console.log(`  [DRY RUN] Would delete local folder: ${thumbDir} (${files.length} files)`);
            localDeletedCount += files.length;
          } else {
            fs.rmSync(thumbDir, { recursive: true, force: true });
            console.log(`  Deleted local folder: ${thumbDir} (${files.length} files)`);
            localDeletedCount += files.length;
          }
        }

        // Faces folder
        const facesDir = path.join(eventsDir, eventFolder, 'faces');
        if (fs.existsSync(facesDir)) {
          const files = fs.readdirSync(facesDir);
          if (isDryRun) {
            console.log(`  [DRY RUN] Would delete local folder: ${facesDir} (${files.length} files)`);
            localDeletedCount += files.length;
          } else {
            fs.rmSync(facesDir, { recursive: true, force: true });
            console.log(`  Deleted local folder: ${facesDir} (${files.length} files)`);
            localDeletedCount += files.length;
          }
        }
      }
    }
    console.log(`  Local cleanup complete: ${localDeletedCount} files removed.`);
  } catch (localErr) {
    console.warn(`  Warning: Local cleanup error: ${localErr.message}`);
  }

  // 3. Database Cleanup (photos table)
  console.log('\n[3/3] Updating database records...');
  try {
    const countWithThumb = await prisma.photo.count({
      where: {
        thumbnailUrl: { not: null }
      }
    });

    console.log(`  Found ${countWithThumb} photo records with thumbnailUrl in database.`);

    if (countWithThumb > 0) {
      if (isDryRun) {
        console.log(`  [DRY RUN] Would reset thumbnailUrl to null for ${countWithThumb} records.`);
      } else {
        const updateResult = await prisma.photo.updateMany({
          where: {
            thumbnailUrl: { not: null }
          },
          data: {
            thumbnailUrl: null
          }
        });
        console.log(`  Successfully reset thumbnailUrl for ${updateResult.count} photo records.`);
      }
    } else {
      console.log('  All database photo records already have null thumbnailUrl.');
    }
  } catch (dbErr) {
    console.error(`  Error updating database: ${dbErr.message}`);
  }

  console.log('\n====================================================');
  console.log('[R2 Asset Cleanup] Summary:');
  console.log(`  - Thumbnails identified: ${r2ThumbnailsCount}`);
  console.log(`  - Face crops identified: ${r2FacesCount}`);
  console.log(`  - Total R2 deleted:      ${r2DeletedTotal}`);
  console.log(`  - Local files deleted:   ${localDeletedCount}`);
  console.log(`  - Status:                ${isDryRun ? 'DRY RUN COMPLETE' : 'COMPLETED SUCCESSFULLY'}`);
  console.log('====================================================\n');
}

cleanupThumbnailsAndFaces()
  .catch(err => {
    console.error('Fatal error during cleanup:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
