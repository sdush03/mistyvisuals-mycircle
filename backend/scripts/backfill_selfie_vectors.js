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
      if (file.startsWith('temp_')) continue;

      try {
        let userId = null;

        if (file.startsWith('user_')) {
          const parts = file.replace('user_', '').split('.');
          userId = parseInt(parts[0], 10);
        } else if (file.startsWith('guest_')) {
          // Resolve to userId via guest -> circle_user
          const parts = file.replace('guest_', '').split('.');
          const guestId = parseInt(parts[0], 10);
          if (!isNaN(guestId)) {
            const guest = await prisma.guest.findUnique({ where: { id: guestId }, select: { email: true } });
            if (guest?.email) {
              const user = await prisma.circleUser.findUnique({ where: { email: guest.email }, select: { id: true } });
              if (user) userId = user.id;
            }
          }
        }

        if (!userId || isNaN(userId)) continue;

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

        // Update circle_users only — single source of truth
        await prisma.circleUser.update({
          where: { id: userId },
          data: { selfieVector: vector }
        }).catch(err => console.warn(`[Backfill] CircleUser ${userId} update failed:`, err.message));

        console.log(`[Backfill] ✓ Updated circle_users selfieVector for userId ${userId}`);
      } catch (err) {
        console.error(`[Backfill] Error processing ${file}:`, err.message);
      }
    }
  }

  // Phase 2: Recalculate matchCount for all guests by reading vector from circle_users
  console.log('[Backfill] Recalculating matchCount via circle_users.selfie_vector...');
  const usersWithVector = await prisma.circleUser.findMany({
    where: { selfieVector: { not: null } },
    select: { id: true, email: true, selfieVector: true }
  });

  console.log(`[Backfill] Found ${usersWithVector.length} circle_users with selfie vectors.`);

  for (const user of usersWithVector) {
    const vector = user.selfieVector;
    if (!Array.isArray(vector) || vector.length === 0) continue;

    const guestProfiles = await prisma.guest.findMany({
      where: { email: user.email },
      select: { id: true, eventId: true, matchCount: true }
    });

    for (const g of guestProfiles) {
      try {
        const matches = await qdrant.searchVectors(g.eventId, vector, 100000, 0.35);
        const uniquePhotoCount = new Set(matches.map(m => m.photo_id)).size;

        if (uniquePhotoCount !== g.matchCount) {
          await prisma.guest.update({
            where: { id: g.id },
            data: { matchCount: uniquePhotoCount }
          });
          console.log(`[Backfill] Guest ${g.id} (Event ${g.eventId}) matchCount: ${g.matchCount} -> ${uniquePhotoCount}`);
        }
      } catch (err) {
        console.error(`[Backfill] Failed matchCount sync for guest ${g.id}:`, err.message);
      }
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
