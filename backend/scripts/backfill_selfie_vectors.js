const fs = require('fs');
const path = require('path');
const { prisma } = require('../prisma');
const qdrant = require('../utils/qdrant');
const faceRecManager = require('../utils/faceRecManager');

async function backfillSelfieVectors() {
  console.log('[Backfill] Starting selfie vector DB backfill script...');

  const selfiesDir = path.join(__dirname, '..', 'uploads', 'photos', 'selfies');
  if (!fs.existsSync(selfiesDir)) {
    console.log('[Backfill] No selfies directory found at:', selfiesDir);
  } else {
    const files = fs.readdirSync(selfiesDir);
    console.log(`[Backfill] Found ${files.length} files in ${selfiesDir}`);

    for (const file of files) {
      if (!file.endsWith('.json') && !file.endsWith('.jpg')) continue;

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

        let vector = null;
        const filePath = path.join(selfiesDir, file);

        if (file.endsWith('.json')) {
          try {
            vector = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          } catch (e) {
            console.error(`[Backfill] Failed to parse JSON ${file}:`, e.message);
          }
        } else if (file.endsWith('.jpg')) {
          try {
            const res = await faceRecManager.validateSelfie(filePath);
            if (res && res.success && res.vector) {
              vector = res.vector;
            }
          } catch (e) {
            console.error(`[Backfill] Failed face extraction for ${file}:`, e.message);
          }
        }

        if (!vector) continue;

        if (userId) {
          await prisma.circleUser.update({
            where: { id: userId },
            data: { selfieVector: vector }
          }).catch(err => console.warn(`[Backfill] CircleUser ${userId} update failed:`, err.message));
        }

        if (guestId) {
          await prisma.guest.update({
            where: { id: guestId },
            data: { selfieVector: vector }
          }).catch(err => console.warn(`[Backfill] Guest ${guestId} update failed:`, err.message));
        }

        // If circleUser was updated, sync vector to all guest records sharing user's email
        if (userId) {
          const user = await prisma.circleUser.findUnique({ where: { id: userId }, select: { email: true } });
          if (user && user.email) {
            await prisma.guest.updateMany({
              where: { email: user.email },
              data: { selfieVector: vector }
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.error(`[Backfill] Error processing ${file}:`, err.message);
      }
    }
  }

  // Phase 2: Recalculate uncapped matchCount for all Guests with selfieVector in DB
  console.log('[Backfill] Recalculating uncapped matchCount in DB...');
  const guestsWithVector = await prisma.guest.findMany({
    where: { selfieVector: { not: null } },
    select: { id: true, eventId: true, selfieVector: true, matchCount: true }
  });

  console.log(`[Backfill] Found ${guestsWithVector.length} guests with selfie vectors in DB.`);

  for (const g of guestsWithVector) {
    try {
      const vector = g.selfieVector;
      if (Array.isArray(vector) && vector.length > 0) {
        const matches = await qdrant.searchVectors(g.eventId, vector, 100000, 0.35);
        const uniquePhotoCount = new Set(matches.map(m => m.photo_id)).size;

        if (uniquePhotoCount !== g.matchCount) {
          await prisma.guest.update({
            where: { id: g.id },
            data: { matchCount: uniquePhotoCount }
          });
          console.log(`[Backfill] Guest ${g.id} (Event ${g.eventId}) updated matchCount: ${g.matchCount} -> ${uniquePhotoCount}`);
        }
      }
    } catch (err) {
      console.error(`[Backfill] Failed matchCount sync for guest ${g.id}:`, err.message);
    }
  }

  console.log('[Backfill] Backfill complete!');
}

if (require.main === module) {
  backfillSelfieVectors()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}

module.exports = { backfillSelfieVectors };
