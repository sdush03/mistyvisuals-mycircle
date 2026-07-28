const fs = require('fs');
const path = require('path');
const { prisma } = require('../prisma');
const { uploadAsset, isR2Enabled } = require('../utils/r2');

async function syncPastSelfiesToR2() {
  console.log('[R2 Sync] Starting past selfies sync to Cloudflare R2...');

  if (!isR2Enabled) {
    console.warn('[R2 Sync] Warning: Cloudflare R2 environment variables are not enabled on this environment.');
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

  for (const file of files) {
    if (!file.endsWith('.jpg')) continue;

    try {
      let userId = null;
      let guestId = null;

      if (file.startsWith('user_')) {
        const parts = file.replace('user_', '').split('.');
        userId = parseInt(parts[0], 10);
      } else if (file.startsWith('guest_')) {
        const parts = file.replace('guest_', '').split('.');
        guestId = parseInt(parts[0], 10);
      }

      if (isNaN(userId)) userId = null;
      if (isNaN(guestId)) guestId = null;

      if (!userId && !guestId) continue;

      const filePath = path.join(selfiesDir, file);
      const buffer = fs.readFileSync(filePath);

      let r2Filename = file;
      if (userId) {
        r2Filename = `user_${userId}.jpg`;
      } else if (guestId) {
        // Resolve userId from guestId if linked
        const guest = await prisma.guest.findUnique({
          where: { id: guestId },
          select: { email: true }
        });
        if (guest && guest.email) {
          const user = await prisma.circleUser.findUnique({
            where: { email: guest.email },
            select: { id: true }
          });
          if (user) {
            userId = user.id;
            r2Filename = `user_${userId}.jpg`;
          }
        }
      }

      console.log(`[R2 Sync] Uploading ${file} -> users/selfies/${r2Filename} ...`);
      const r2Url = await uploadAsset(buffer, r2Filename, 'users/selfies', 'image/jpeg');

      // Update database rows in PostgreSQL
      if (userId) {
        await prisma.circleUser.update({
          where: { id: userId },
          data: { selfieUrl: r2Url }
        }).catch(e => console.warn(`[R2 Sync] CircleUser ${userId} update failed:`, e.message));

        const user = await prisma.circleUser.findUnique({ where: { id: userId }, select: { email: true } });
        if (user && user.email) {
          await prisma.guest.updateMany({
            where: { email: user.email },
            data: { selfieUrl: r2Url }
          }).catch(() => {});
        }
      }

      if (guestId) {
        await prisma.guest.update({
          where: { id: guestId },
          data: { selfieUrl: r2Url }
        }).catch(e => console.warn(`[R2 Sync] Guest ${guestId} update failed:`, e.message));
      }

      syncedCount++;
      console.log(`[R2 Sync] Successfully synced ${r2Filename} -> ${r2Url}`);
    } catch (err) {
      console.error(`[R2 Sync] Failed to sync ${file}:`, err.message);
    }
  }

  console.log(`[R2 Sync] Complete! Synced: ${syncedCount}, Skipped: ${skippedCount}`);
}

if (require.main === module) {
  syncPastSelfiesToR2()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}

module.exports = { syncPastSelfiesToR2 };
