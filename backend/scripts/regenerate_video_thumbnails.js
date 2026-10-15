/**
 * regenerate_video_thumbnails.js
 * 
 * Recovers and regenerates video poster thumbnails (600px JPEG) for all video files
 * across all gallery events that had their thumbnailUrl wiped during the 600px thumbnail reset.
 * 
 * Uses FFmpeg (seeking remotely at 1s via range requests) to extract the frame,
 * resizes to crisp 600px via Sharp, uploads to Cloudflare R2 under events/{slug}/thumbnails/thumb_{base}.jpg,
 * and updates thumbnailUrl in the database.
 * 
 * Usage:
 *   node backend/scripts/regenerate_video_thumbnails.js
 *   node backend/scripts/regenerate_video_thumbnails.js --dry-run
 *   node backend/scripts/regenerate_video_thumbnails.js --event <eventId_or_slug>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const sharp = require('sharp');
const { prisma } = require('../modules/quotation/prisma');
const { uploadAsset, isR2Enabled } = require('../utils/r2');

const isDryRun = process.argv.includes('--dry-run');
const eventArgIndex = process.argv.indexOf('--event');
const eventTarget = eventArgIndex !== -1 ? process.argv[eventArgIndex + 1] : null;

// Locate FFmpeg binary: system ffmpeg or uploader bundled ffmpeg
function getFfmpegBinary() {
  const possiblePaths = [
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    path.join(__dirname, '..', '..', 'uploader', 'node_modules', '@ffmpeg-installer', 'darwin-arm64', 'ffmpeg'),
    path.join(__dirname, '..', '..', 'uploader', 'node_modules', '@ffmpeg-installer', 'darwin-x64', 'ffmpeg'),
    path.join(__dirname, '..', '..', 'uploader', 'node_modules', '@ffmpeg-installer', 'linux-x64', 'ffmpeg'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer && installer.path) return installer.path;
  } catch (_) {}
  return 'ffmpeg';
}

function extractFrame(ffmpeg, videoUrl, outputPath, seekTime = '00:00:01.000') {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpeg,
      ['-y', '-ss', seekTime, '-i', videoUrl, '-vframes', '1', '-q:v', '2', outputPath],
      { timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) {
          // If 1s seek failed, try at 0s
          if (seekTime !== '00:00:00.000') {
            return extractFrame(ffmpeg, videoUrl, outputPath, '00:00:00.000')
              .then(resolve)
              .catch(reject);
          }
          return reject(new Error(stderr || err.message));
        }
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
          return reject(new Error('Extracted frame is 0 bytes'));
        }
        resolve();
      }
    );
  });
}

async function main() {
  console.log('====================================================');
  console.log(`[Video Thumbnail Recovery] Starting ${isDryRun ? 'DRY RUN' : 'REGENERATION'}...`);
  if (eventTarget) {
    console.log(`Targeting single event: ${eventTarget}`);
  }
  console.log('====================================================');

  const ffmpeg = getFfmpegBinary();
  console.log(`Using FFmpeg binary: ${ffmpeg}`);

  const whereClause = {
    OR: [
      { filename: { endsWith: '.mp4', mode: 'insensitive' } },
      { filename: { endsWith: '.mov', mode: 'insensitive' } },
      { filename: { endsWith: '.m4v', mode: 'insensitive' } },
      { filename: { endsWith: '.webm', mode: 'insensitive' } },
      { r2Url: { endsWith: '.mp4', mode: 'insensitive' } },
      { r2Url: { endsWith: '.mov', mode: 'insensitive' } },
      { r2Url: { endsWith: '.m4v', mode: 'insensitive' } },
      { r2Url: { endsWith: '.webm', mode: 'insensitive' } },
      { tabName: { equals: 'cinema', mode: 'insensitive' } }
    ]
  };

  if (eventTarget) {
    const numericId = parseInt(eventTarget, 10);
    if (!isNaN(numericId)) {
      whereClause.eventId = numericId;
    } else {
      const event = await prisma.galleryEvent.findUnique({ where: { slug: eventTarget } });
      if (!event) {
        console.error(`Event with slug "${eventTarget}" not found.`);
        process.exit(1);
      }
      whereClause.eventId = event.id;
    }
  }

  const videos = await prisma.photo.findMany({
    where: whereClause,
    include: {
      event: { select: { id: true, slug: true, title: true } }
    },
    orderBy: { id: 'asc' }
  });

  console.log(`Found ${videos.length} video records.`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video_thumb_recovery_'));
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const eventSlug = v.event?.slug?.toLowerCase().trim() || 'unknown';
    const videoUrl = v.r2Url;
    const baseName = path.basename(v.filename || 'video', path.extname(v.filename || 'video.mp4'));
    const thumbFilename = `thumb_${baseName}.jpg`;
    const subfolder = `events/${eventSlug}/thumbnails`;

    console.log(`\n[${i + 1}/${videos.length}] Video #${v.id} (${v.filename || 'unnamed'}) in "${v.event?.title || eventSlug}"`);
    console.log(`  Current thumbnailUrl: ${v.thumbnailUrl || '(null)'}`);

    if (!videoUrl || (!videoUrl.endsWith('.mp4') && !videoUrl.endsWith('.mov') && !videoUrl.endsWith('.m4v') && !videoUrl.endsWith('.webm') && !videoUrl.includes('/photos/') && !videoUrl.includes('/videos/'))) {
      console.log(`  Skipping: not a direct video URL (${videoUrl})`);
      continue;
    }

    if (isDryRun) {
      console.log(`  [DRY RUN] Would extract frame from ${videoUrl} and upload to ${subfolder}/${thumbFilename}`);
      successCount++;
      continue;
    }

    const tempFramePath = path.join(tempDir, `frame_${v.id}_${Date.now()}.jpg`);
    try {
      console.log(`  Extracting frame via FFmpeg...`);
      await extractFrame(ffmpeg, videoUrl, tempFramePath);

      console.log(`  Resizing to crisp 600px poster...`);
      const posterBuffer = await sharp(tempFramePath)
        .resize(600, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();

      console.log(`  Uploading ${posterBuffer.length} bytes to R2: ${subfolder}/${thumbFilename}...`);
      const newThumbnailUrl = await uploadAsset(posterBuffer, thumbFilename, subfolder, 'image/jpeg');

      console.log(`  Updating database record...`);
      await prisma.photo.update({
        where: { id: v.id },
        data: { thumbnailUrl: newThumbnailUrl }
      });

      console.log(`  ✅ Successfully restored thumbnail: ${newThumbnailUrl}`);
      successCount++;
    } catch (err) {
      console.error(`  ❌ Failed to regenerate thumbnail for photo #${v.id}:`, err.message);
      failCount++;
    } finally {
      if (fs.existsSync(tempFramePath)) {
        try { fs.unlinkSync(tempFramePath); } catch (_) {}
      }
    }
  }

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n====================================================');
  console.log('[Video Thumbnail Recovery] Complete:');
  console.log(`  - Successfully processed: ${successCount}`);
  console.log(`  - Failed:                 ${failCount}`);
  console.log('====================================================');
}

main()
  .catch(err => {
    console.error('Fatal error in video thumbnail recovery:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
