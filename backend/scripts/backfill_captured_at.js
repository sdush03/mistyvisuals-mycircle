/**
 * Backfill `captured_at` timestamps for photos where it is currently NULL.
 *
 * Priority order per photo:
 *   1. EXIF DateTimeOriginal / CreateDate / ModifyDate  — read from the actual R2 file
 *   2. Date pattern embedded in the filename            — e.g. DSC_20251201_143022.jpg
 *   3. DB `created_at`                                  — last resort (upload time)
 *
 * Run:
 *   node backend/scripts/backfill_captured_at.js
 *
 * Optional flags:
 *   --event=vandana-mayank   Limit to a specific event slug
 *   --dry-run                Print what would happen without writing to DB
 *   --concurrency=5          Parallel downloads (default: 4)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { prisma } = require('../prisma');

// ─── Config ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONCURRENCY = parseInt((args.find(a => a.startsWith('--concurrency=')) || '--concurrency=4').split('=')[1], 10);
const EVENT_SLUG = (args.find(a => a.startsWith('--event=')) || '').split('=')[1] || null;

const TEMP_DIR = path.join(os.tmpdir(), 'misty_backfill_capturedat');

// ─── EXIF via sharp (no exifr in backend deps) ────────────────────────────────

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('[Backfill] "sharp" is required. Run: npm install sharp');
  process.exit(1);
}

/**
 * Parse EXIF date tags from a file buffer using sharp's metadata().
 * Sharp exposes `exif` as a raw buffer — we do a simple string scan for the
 * EXIF date pattern `YYYY:MM:DD HH:MM:SS` which is reliable and dep-free.
 */
function parseDateFromExifBuffer(exifBuf) {
  if (!exifBuf) return null;
  try {
    // EXIF DateTime fields are ASCII strings: "YYYY:MM:DD HH:MM:SS"
    const str = exifBuf.toString('binary');
    // Find all date-like patterns
    const matches = [...str.matchAll(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/g)];
    if (!matches.length) return null;

    // Filter out obviously wrong dates (year < 2000 or > current year + 1)
    const currentYear = new Date().getFullYear();
    const valid = matches
      .map(m => {
        const [, yr, mo, dy, hh, mm, ss] = m;
        const d = new Date(`${yr}-${mo}-${dy}T${hh}:${mm}:${ss}`);
        return isNaN(d.getTime()) ? null : d;
      })
      .filter(d => d && d.getFullYear() >= 2000 && d.getFullYear() <= currentYear + 1);

    if (!valid.length) return null;

    // Return the earliest valid date (most likely to be capture time)
    valid.sort((a, b) => a - b);
    return valid[0];
  } catch {
    return null;
  }
}

async function extractCapturedAtFromUrl(url) {
  const tmpFile = path.join(TEMP_DIR, `photo_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await downloadFile(url, tmpFile);
    const meta = await sharp(tmpFile).metadata();
    const exifDate = parseDateFromExifBuffer(meta.exif);
    return exifDate;
  } catch (err) {
    return null;
  } finally {
    if (fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }
}

// ─── Filename date extraction ─────────────────────────────────────────────────

/**
 * Try to find a YYYYMMDD or YYYY-MM-DD pattern in the filename.
 * Examples: DSC_20251201_143022.jpg  |  2025-12-01_shot.jpg  |  IMG_20251201.jpg
 */
function extractDateFromFilename(filename) {
  // Patterns: YYYYMMDD_HHMMSS, YYYYMMDD, YYYY-MM-DD, YYYY_MM_DD
  const patterns = [
    /(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})[-_]?(\d{2})[-_]?(\d{2})/,  // with time
    /(\d{4})[-_](\d{2})[-_](\d{2})/,                                          // date only with sep
    /(\d{4})(\d{2})(\d{2})/,                                                   // compact YYYYMMDD
  ];

  for (const re of patterns) {
    const m = filename.match(re);
    if (!m) continue;
    const [, yr, mo, dy, hh = '00', mm = '00', ss = '00'] = m;
    const yr_n = parseInt(yr, 10);
    const mo_n = parseInt(mo, 10);
    const dy_n = parseInt(dy, 10);
    const currentYear = new Date().getFullYear();
    if (yr_n < 2000 || yr_n > currentYear + 1 || mo_n < 1 || mo_n > 12 || dy_n < 1 || dy_n > 31) continue;
    const d = new Date(`${yr}-${mo}-${dy}T${hh}:${mm}:${ss}`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// ─── HTTP download helper ─────────────────────────────────────────────────────

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, res => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────

async function runPool(items, concurrency, fn) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  // Build where clause
  const whereClause = { capturedAt: null };
  if (EVENT_SLUG) {
    const event = await prisma.galleryEvent.findUnique({ where: { slug: EVENT_SLUG } });
    if (!event) {
      console.error(`[Backfill] Event with slug "${EVENT_SLUG}" not found.`);
      process.exit(1);
    }
    whereClause.eventId = event.id;
    console.log(`[Backfill] Limiting to event: "${event.name}" (id: ${event.id})`);
  }

  const photos = await prisma.photo.findMany({
    where: whereClause,
    select: {
      id: true,
      filename: true,
      r2Url: true,
      createdAt: true,
      eventId: true
    },
    orderBy: { id: 'asc' }
  });

  console.log(`[Backfill] Found ${photos.length} photos with null capturedAt${DRY_RUN ? ' [DRY RUN — no DB writes]' : ''}`);
  if (photos.length === 0) {
    console.log('[Backfill] Nothing to do. All photos already have capturedAt set.');
    return;
  }

  let exifSuccess = 0;
  let filenameSuccess = 0;
  let fallbackSuccess = 0;
  let failed = 0;

  await runPool(photos, CONCURRENCY, async (photo, i) => {
    const label = `[${i + 1}/${photos.length}] ${photo.filename}`;
    let capturedAt = null;
    let method = '';

    // ── Priority 1: EXIF from R2 file
    if (photo.r2Url && (photo.r2Url.startsWith('http://') || photo.r2Url.startsWith('https://'))) {
      try {
        const d = await extractCapturedAtFromUrl(photo.r2Url);
        if (d) {
          capturedAt = d;
          method = 'EXIF';
          exifSuccess++;
        }
      } catch (err) {
        // Will fall through to next priority
      }
    }

    // ── Priority 2: Date from filename
    if (!capturedAt) {
      const d = extractDateFromFilename(photo.filename);
      if (d) {
        capturedAt = d;
        method = 'FILENAME';
        filenameSuccess++;
      }
    }

    // ── Priority 3: DB createdAt (upload time)
    if (!capturedAt) {
      capturedAt = photo.createdAt;
      method = 'DB_CREATED_AT';
      fallbackSuccess++;
    }

    if (!capturedAt) {
      console.error(`  ✗ ${label} — could not determine date`);
      failed++;
      return;
    }

    const isoStr = capturedAt instanceof Date ? capturedAt.toISOString() : new Date(capturedAt).toISOString();
    console.log(`  ${DRY_RUN ? '[DRY]' : '✓'} ${label} → ${isoStr} [${method}]`);

    if (!DRY_RUN) {
      try {
        await prisma.photo.update({
          where: { id: photo.id },
          data: { capturedAt }
        });
      } catch (updateErr) {
        console.error(`  ✗ ${label} — DB update failed: ${updateErr.message}`);
        failed++;
      }
    }
  });

  console.log('\n─────────────────────────────────────────');
  console.log(`[Backfill] Complete.`);
  console.log(`  ✓ EXIF:               ${exifSuccess}`);
  console.log(`  ✓ Filename pattern:   ${filenameSuccess}`);
  console.log(`  ✓ DB createdAt:       ${fallbackSuccess}`);
  console.log(`  ✗ Failed:             ${failed}`);
  console.log(`  Total processed:      ${photos.length}`);
  if (DRY_RUN) console.log('\n  [DRY RUN] No changes were written to the database.');
}

main()
  .catch(err => {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
