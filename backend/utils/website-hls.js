/**
 * HLS Video Transcoding Pipeline (Async / Background)
 *
 * Flow:
 *  1. Admin uploads raw video → saved to /media/website/films/{id}/raw/original.{ext}
 *  2. DB status set to 'processing'
 *  3. FFmpeg runs in background — does NOT block the HTTP response
 *  4. On completion: HLS segments written, DB updated to 'ready', hls_url set
 *  5. Admin polls GET /api/website/films/:id for status
 *
 * HLS Output Structure:
 *   /media/website/films/{id}/stream/
 *     master.m3u8
 *     4k/        index.m3u8 + *.ts   (if source is >= 2160p)
 *     1080p/     index.m3u8 + *.ts
 *     720p/      index.m3u8 + *.ts
 *
 * Background video optimization:
 *   /media/website/homepage/hero/{id}-bg.mp4  (720p, 1.2Mbps, H.264, no audio)
 */

const path  = require('path')
const fs    = require('fs')
const cp    = require('child_process')
const { promisify } = require('util')
const exec  = promisify(cp.exec)

const WEBSITE_MEDIA_DIR = process.env.WEBSITE_MEDIA_DIR
  || path.join(process.cwd(), 'media', 'website')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * Check if FFmpeg is available on this system.
 * @returns {Promise<boolean>}
 */
async function isFfmpegAvailable() {
  try {
    await exec('ffmpeg -version')
    return true
  } catch {
    return false
  }
}

/**
 * Get source video dimensions.
 * @param {string} inputPath
 * @returns {Promise<{width: number, height: number}>}
 */
async function getVideoMetadata(inputPath) {
  try {
    const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${inputPath}"`
    const { stdout } = await exec(cmd)
    const data = JSON.parse(stdout)
    const stream = data.streams?.[0] || {}
    return { width: stream.width || 0, height: stream.height || 0 }
  } catch {
    return { width: 0, height: 0 }
  }
}

/**
 * Transcode a raw video to adaptive HLS (4K/1080p/720p).
 * Runs entirely asynchronously — returns immediately after spawning.
 *
 * @param {object} opts
 * @param {number} opts.filmId
 * @param {string} opts.rawPath     Absolute path to the source video
 * @param {object} opts.pool        pg Pool
 * @returns {void}
 */
function transcodeFilmAsync({ filmId, rawPath, pool }) {
  // Fire and forget — do not await
  _transcodeFilm({ filmId, rawPath, pool }).catch(err => {
    console.error(`[hls] Transcode failed for film ${filmId}:`, err?.message || err)
    pool.query(
      `UPDATE website_films SET transcode_status = 'error', transcode_error = $1, updated_at = NOW() WHERE id = $2`,
      [err?.message || 'Unknown error', filmId]
    ).catch(() => null)
  })
}

async function _transcodeFilm({ filmId, rawPath, pool }) {
  console.log(`[hls] Starting transcode for film ${filmId}: ${rawPath}`)

  const streamDir = path.join(WEBSITE_MEDIA_DIR, 'films', String(filmId), 'stream')
  ensureDir(streamDir)

  // Get source resolution to decide which renditions to generate
  const { width, height } = await getVideoMetadata(rawPath)
  const sourceHeight = height || 0

  console.log(`[hls] Source resolution: ${width}x${height}`)

  // Determine which renditions to create based on source height
  const renditions = []
  if (sourceHeight >= 2160) {
    renditions.push({ label: '4k',    height: 2160, bitrate: '12000k', bufsize: '18000k', audioBitrate: '256k' })
  }
  if (sourceHeight >= 1080 || renditions.length === 0) {
    renditions.push({ label: '1080p', height: 1080, bitrate: '4500k',  bufsize: '6750k',  audioBitrate: '192k' })
  }
  renditions.push({ label: '720p',  height: 720,  bitrate: '2500k',  bufsize: '3750k',  audioBitrate: '128k' })

  // Transcode each rendition
  for (const r of renditions) {
    const outDir = path.join(streamDir, r.label)
    ensureDir(outDir)
    const outPlaylist = path.join(outDir, 'index.m3u8')
    const outSegment  = path.join(outDir, 'seg%04d.ts')

    // Scale: preserve aspect ratio, force height, keep divisible by 2
    const scaleFilter = `scale=-2:${r.height}`

    const cmd = [
      'ffmpeg', '-y',
      '-i', `"${rawPath}"`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '22',
      '-b:v', r.bitrate,
      '-maxrate', r.bitrate,
      '-bufsize', r.bufsize,
      '-vf', scaleFilter,
      '-c:a', 'aac',
      '-b:a', r.audioBitrate,
      '-ac', '2',
      '-ar', '48000',
      '-hls_time', '6',
      '-hls_list_size', '0',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', `"${outSegment}"`,
      '-hls_flags', 'independent_segments',
      '-f', 'hls',
      `"${outPlaylist}"`,
    ].join(' ')

    console.log(`[hls] Transcoding ${r.label} for film ${filmId}...`)
    await exec(cmd, { maxBuffer: 1024 * 1024 * 10 })
    console.log(`[hls] ✅ ${r.label} done for film ${filmId}`)
  }

  // Write adaptive master playlist
  const masterPath = path.join(streamDir, 'master.m3u8')
  let masterContent = '#EXTM3U\n#EXT-X-VERSION:3\n\n'

  const bandwidthMap = { '4k': 13000000, '1080p': 5000000, '720p': 2800000 }
  const resolutionMap = { '4k': '3840x2160', '1080p': '1920x1080', '720p': '1280x720' }

  for (const r of renditions) {
    masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidthMap[r.label]},RESOLUTION=${resolutionMap[r.label]},CODECS="avc1.42E01E,mp4a.40.2",NAME="${r.label}"\n`
    masterContent += `${r.label}/index.m3u8\n\n`
  }

  fs.writeFileSync(masterPath, masterContent)

  // Update DB
  const hlsUrl = `/media/website/films/${filmId}/stream/master.m3u8`
  await pool.query(
    `UPDATE website_films 
     SET hls_url = $1, transcode_status = 'ready', transcode_error = NULL, updated_at = NOW() 
     WHERE id = $2`,
    [hlsUrl, filmId]
  )

  console.log(`[hls] ✅ Film ${filmId} fully transcoded. HLS URL: ${hlsUrl}`)
}

/**
 * Optimize a background video for homepage use.
 * Outputs lightweight 720p H.264 with no audio.
 *
 * @param {string} inputPath   Source video path
 * @param {string} outputPath  Destination path (e.g. .../hero-bg.mp4)
 * @returns {Promise<void>}
 */
async function optimizeBackgroundVideo(inputPath, outputPath) {
  ensureDir(path.dirname(outputPath))
  const cmd = [
    'ffmpeg', '-y',
    '-i', `"${inputPath}"`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '26',
    '-b:v', '1200k',
    '-maxrate', '1500k',
    '-bufsize', '2400k',
    '-vf', 'scale=-2:720',
    '-an',
    '-movflags', '+faststart',
    '-f', 'mp4',
    `"${outputPath}"`,
  ].join(' ')

  await exec(cmd, { maxBuffer: 1024 * 1024 * 10 })
}

module.exports = {
  transcodeFilmAsync,
  optimizeBackgroundVideo,
  isFfmpegAvailable,
  WEBSITE_MEDIA_DIR,
}
