require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { prisma } = require('../prisma');
const { isR2Enabled } = require('../utils/r2');
const { PHOTO_UPLOAD_DIR } = require('../config/constants');

const isDryRun = process.argv.includes('--dry-run');

async function cleanupThumbnails() {
  console.log('====================================================');
  console.log(`[Thumbnail Cleanup] Starting ${isDryRun ? 'DRY RUN' : 'CLEANUP'}...`);
  console.log('====================================================');

  let r2DeletedCount = 0;
  let localDeletedCount = 0;

  // 1. Cloudflare R2 Bucket Cleanup
  if (isR2Enabled) {
    console.log('\n[1/3] Scanning Cloudflare R2 bucket for thumbnail objects...');
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
    const thumbnailKeys = [];

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
        // Match thumbnail objects: inside /thumbnails/ or starting with thumb_
        if (obj.Key.includes('/thumbnails/') || path.basename(obj.Key).startsWith('thumb_')) {
          thumbnailKeys.push({ Key: obj.Key });
        }
      }

      continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
      process.stdout.write(`\r  Scanned ${totalScanned} objects, found ${thumbnailKeys.length} thumbnails...`);
    } while (continuationToken);

    console.log(`\n  Total thumbnail objects identified in R2: ${thumbnailKeys.length}`);

    if (thumbnailKeys.length > 0) {
      if (isDryRun) {
        console.log(`  [DRY RUN] Would delete ${thumbnailKeys.length} objects from R2.`);
        r2DeletedCount = thumbnailKeys.length;
      } else {
        console.log(`  Deleting ${thumbnailKeys.length} thumbnail objects from R2 in batches of 1000...`);
        const BATCH_SIZE = 1000;
        for (let i = 0; i < thumbnailKeys.length; i += BATCH_SIZE) {
          const batch = thumbnailKeys.slice(i, i + BATCH_SIZE);
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
          r2DeletedCount += batch.length - errors.length;
          process.stdout.write(`\r  Deleted ${r2DeletedCount}/${thumbnailKeys.length} objects from R2...`);
        }
        console.log(`\n  Successfully deleted ${r2DeletedCount} thumbnail objects from R2.`);
      }
    } else {
      console.log('  No thumbnail objects found in R2.');
    }
  } else {
    console.log('\n[1/3] R2 is not enabled in this environment. Skipping R2 bucket scan.');
  }

  // 2. Local Disk Cleanup (if any local thumbnails exist)
  console.log('\n[2/3] Checking for local disk thumbnail folders...');
  try {
    const eventsDir = path.join(PHOTO_UPLOAD_DIR, 'events');
    if (fs.existsSync(eventsDir)) {
      const eventFolders = fs.readdirSync(eventsDir);
      for (const eventFolder of eventFolders) {
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
  console.log('[Thumbnail Cleanup] Summary:');
  console.log(`  - R2 objects deleted:     ${r2DeletedCount}`);
  console.log(`  - Local files deleted:   ${localDeletedCount}`);
  console.log(`  - Status:                ${isDryRun ? 'DRY RUN COMPLETE' : 'COMPLETED SUCCESSFULLY'}`);
  console.log('====================================================\n');
}

cleanupThumbnails()
  .catch(err => {
    console.error('Fatal error during cleanup:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
