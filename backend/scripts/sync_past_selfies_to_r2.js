const fs = require('fs');
const path = require('path');
const { prisma } = require('../prisma');
const { uploadAssetWithRetry, isR2Enabled } = require('../utils/r2');

/**
 * Syncs all existing local selfie files to Cloudflare R2,
 * updates circle_users.selfie_url in the DB, then deletes the local file.
 *
 * Run this ONCE before deploying the disk-free selfie architecture.
 */
async function syncPastSelfiesToR2() {
  console.log('[R2 Sync] Starting past selfies sync to Cloudflare R2...');

  if (!isR2Enabled) {
    console.warn('[R2 Sync] Warning: Cloudflare R2 environment variables are not configured.');
    console.warn('[R2 Sync] Ensure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_PUBLIC_DOMAIN_URL are set.');
    return;
  }

  const selfiesDir = path.join(__dirname, '..', 'uploads', 'photos', 'selfies');
  if (!fs.existsSync(selfiesDir)) {
    console.log('[R2 Sync] No selfies directory found at:', selfiesDir);
    return;
  }

  const files = fs.readdirSync(selfiesDir);
  console.log(`[R2 Sync] Found ${files.length} files in ${selfiesDir}`);

  let syncedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const file of files) {
    // Only process .jpg selfie files, skip temp files and .json vectors
    if (!file.endsWith('.jpg')) { skippedCount++; continue; }
    if (file.startsWith('temp_')) { skippedCount++; continue; }

    try {
      let userId = null;

      if (file.startsWith('user_')) {
        const parts = file.replace('user_', '').split('.');
        userId = parseInt(parts[0], 10);
      } else if (file.startsWith('guest_')) {
        // Resolve userId from guest email -> circle_user
        const parts = file.replace('guest_', '').split('.');
        const guestId = parseInt(parts[0], 10);
        if (!isNaN(guestId)) {
          const guest = await prisma.guest.findUnique({
            where: { id: guestId },
            select: { email: true }
          });
          if (guest?.email) {
            const user = await prisma.circleUser.findUnique({
              where: { email: guest.email },
              select: { id: true }
            });
            if (user) userId = user.id;
          }
        }
      }

      if (!userId || isNaN(userId)) { skippedCount++; continue; }

      const filePath = path.join(selfiesDir, file);
      const buffer = fs.readFileSync(filePath);
      const r2Filename = `user_${userId}.jpg`;

      console.log(`[R2 Sync] Uploading ${file} -> users/selfies/${r2Filename} ...`);
      const r2Url = await uploadAssetWithRetry(buffer, r2Filename, 'users/selfies', 'image/jpeg');

      // Update circle_users only — single source of truth
      await prisma.circleUser.update({
        where: { id: userId },
        data: { selfieUrl: r2Url }
      }).catch(e => console.warn(`[R2 Sync] CircleUser ${userId} update failed:`, e.message));

      syncedCount++;
      console.log(`[R2 Sync] ✓ Synced ${r2Filename} -> ${r2Url}`);

      // Delete local file after successful R2 upload + DB update
      try {
        fs.unlinkSync(filePath);
        console.log(`[R2 Sync] ✓ Deleted local file: ${file}`);

        // Also delete .json vector file if present (vector is stored in DB now)
        const jsonPath = filePath.replace('.jpg', '.json');
        if (fs.existsSync(jsonPath)) {
          fs.unlinkSync(jsonPath);
          console.log(`[R2 Sync] ✓ Deleted local vector: ${file.replace('.jpg', '.json')}`);
        }
      } catch (delErr) {
        console.warn(`[R2 Sync] Could not delete local file ${file}:`, delErr.message);
      }
    } catch (err) {
      failedCount++;
      console.error(`[R2 Sync] ✗ Failed to sync ${file}:`, err.message);
    }
  }

  console.log(`\n[R2 Sync] Complete! Synced: ${syncedCount}, Skipped: ${skippedCount}, Failed: ${failedCount}`);
  if (failedCount > 0) {
    console.warn('[R2 Sync] Some files failed — re-run this script to retry.');
  }
}

if (require.main === module) {
  syncPastSelfiesToR2()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}

module.exports = { syncPastSelfiesToR2 };
