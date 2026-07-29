/**
 * Backfill selfie vectors for circle_users who have a selfieUrl (R2) but no selfieVector.
 * Downloads each selfie from R2, runs face recognition, saves vector to circle_users.
 *
 * Run: node backend/scripts/backfill_selfie_vectors.js
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { prisma } = require('../prisma');
const faceRecManager = require('../utils/faceRecManager');

const TEMP_DIR = '/tmp/selfie_backfill';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const users = await prisma.$queryRaw`
    SELECT id, email, selfie_url AS "selfieUrl"
    FROM circle_users
    WHERE selfie_url IS NOT NULL AND selfie_vector IS NULL
  `;

  console.log(`[Backfill] Found ${users.length} users with selfieUrl but no selfieVector`);

  let success = 0, failed = 0;

  for (const user of users) {
    const tempPath = path.join(TEMP_DIR, `user_${user.id}.jpg`);
    try {
      console.log(`[Backfill] Processing ${user.email} (id: ${user.id}) ...`);

      await download(user.selfieUrl, tempPath);

      const res = await faceRecManager.validateSelfie(tempPath);
      if (!res.success || !res.vector) {
        console.warn(`  ✗ Face validation failed: ${res.error}`);
        failed++;
        continue;
      }

      await prisma.circleUser.update({
        where: { id: user.id },
        data: { selfieVector: res.vector }
      });

      console.log(`  ✓ Vector saved (${res.vector.length} dims)`);
      success++;
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
      failed++;
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  console.log(`\n[Backfill] Done. Success: ${success}, Failed: ${failed}`);
}

main().finally(() => prisma.$disconnect());
