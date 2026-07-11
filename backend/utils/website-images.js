/**
 * Website Image Optimization Pipeline
 * Uses Sharp to generate responsive WebP variants + blur placeholder.
 *
 * Media directory structure:
 *   /media/website/stories/{slug}/desktop/{hash}.webp   (1920px, quality 82) — PUBLIC
 *   /media/website/stories/{slug}/mobile/{hash}.webp    ( 800px, quality 78) — PUBLIC
 *   /media/website/stories/{slug}/thumbs/{hash}.webp    ( 400px, quality 70) — PUBLIC
 *   /media/website/stories/{slug}/originals/{hash}.jpg  (archival, NOT publicly served)
 *
 *   /media/website/homepage/hero/{ts}-desktop.webp      (2560px) — PUBLIC
 *   /media/website/homepage/hero/{ts}-mobile.webp       (1080px) — PUBLIC
 *
 *   /media/website/films/{id}/thumb/{ts}.webp            — PUBLIC
 */

const path = require('path')
const fs   = require('fs')
const crypto = require('crypto')

let sharp
try {
  sharp = require('sharp')
} catch {
  console.error('[website-images] FATAL: sharp is not installed. Run: npm install sharp')
  process.exit(1)
}

const WEBSITE_MEDIA_DIR = process.env.WEBSITE_MEDIA_DIR
  || path.join(process.cwd(), 'media', 'website')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * Generate a tiny base64 blur placeholder (~10px wide).
 * @param {Buffer} inputBuffer
 * @returns {Promise<string>} data:image/webp;base64,....
 */
async function generateBlurPlaceholder(inputBuffer) {
  const tinyBuf = await sharp(inputBuffer)
    .resize(16, null, { fit: 'inside' })
    .webp({ quality: 20 })
    .toBuffer()
  return `data:image/webp;base64,${tinyBuf.toString('base64')}`
}

/**
 * Process a story photo upload.
 * Saves archival JPEG + three WebP variants + blur placeholder.
 *
 * @param {Buffer} inputBuffer   Raw file buffer from multipart upload
 * @param {string} slug          Story slug (used for directory path)
 * @param {string} [originalFilename]
 * @returns {Promise<{
 *   fileUrl: string,
 *   fileUrlMobile: string,
 *   fileUrlThumb: string,
 *   blurDataUrl: string,
 *   hash: string,
 * }>}
 */
async function processStoryPhoto(inputBuffer, slug, originalFilename = '') {
  const hash = crypto
    .createHash('sha256')
    .update(inputBuffer)
    .digest('hex')
    .slice(0, 24)

  const safeSlug = slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase()

  const dirs = {
    originals: path.join(WEBSITE_MEDIA_DIR, 'stories', safeSlug, 'originals'),
    desktop:   path.join(WEBSITE_MEDIA_DIR, 'stories', safeSlug, 'desktop'),
    mobile:    path.join(WEBSITE_MEDIA_DIR, 'stories', safeSlug, 'mobile'),
    thumbs:    path.join(WEBSITE_MEDIA_DIR, 'stories', safeSlug, 'thumbs'),
  }

  for (const dir of Object.values(dirs)) ensureDir(dir)

  const metadata = await sharp(inputBuffer).metadata()
  const isPortrait = metadata.height > metadata.width

  // Resolve dimensions — never upscale
  const desktopWidth  = Math.min(1920, metadata.width)
  const mobileWidth   = Math.min(800, metadata.width)
  const thumbWidth    = Math.min(400, metadata.width)

  const sharpOpts = { fit: 'inside', withoutEnlargement: true }

  // Archival original (max 5000px wide, high quality JPEG, NOT publicly served)
  const archiveWidth = Math.min(5000, metadata.width)
  const archivePath  = path.join(dirs.originals, `${hash}.jpg`)
  if (!fs.existsSync(archivePath)) {
    await sharp(inputBuffer)
      .resize(archiveWidth, null, sharpOpts)
      .jpeg({ quality: 95, mozjpeg: true })
      .toFile(archivePath)
  }

  // Desktop WebP (1920px)
  const desktopFile = `${hash}.webp`
  const desktopPath = path.join(dirs.desktop, desktopFile)
  if (!fs.existsSync(desktopPath)) {
    await sharp(inputBuffer)
      .resize(desktopWidth, null, sharpOpts)
      .webp({ quality: 82, effort: 4 })
      .toFile(desktopPath)
  }

  // Mobile WebP (800px)
  const mobileFile = `${hash}.webp`
  const mobilePath = path.join(dirs.mobile, mobileFile)
  if (!fs.existsSync(mobilePath)) {
    await sharp(inputBuffer)
      .resize(mobileWidth, null, sharpOpts)
      .webp({ quality: 78, effort: 4 })
      .toFile(mobilePath)
  }

  // Thumbnail WebP (400px)
  const thumbFile = `${hash}.webp`
  const thumbPath = path.join(dirs.thumbs, thumbFile)
  if (!fs.existsSync(thumbPath)) {
    await sharp(inputBuffer)
      .resize(thumbWidth, null, sharpOpts)
      .webp({ quality: 70, effort: 4 })
      .toFile(thumbPath)
  }

  // Blur placeholder
  const blurDataUrl = await generateBlurPlaceholder(inputBuffer)

  return {
    hash,
    fileUrl:       `/media/website/stories/${safeSlug}/desktop/${desktopFile}`,
    fileUrlMobile: `/media/website/stories/${safeSlug}/mobile/${mobileFile}`,
    fileUrlThumb:  `/media/website/stories/${safeSlug}/thumbs/${thumbFile}`,
    blurDataUrl,
  }
}

/**
 * Process a hero image upload.
 * Generates desktop (2560px) and mobile (1080px) WebP variants.
 *
 * @param {Buffer} inputBuffer
 * @returns {Promise<{mediaUrl: string, mobileUrl: string, blurDataUrl: string}>}
 */
async function processHeroImage(inputBuffer) {
  const ts = Date.now()
  const dir = path.join(WEBSITE_MEDIA_DIR, 'homepage', 'hero')
  ensureDir(dir)

  const meta = await sharp(inputBuffer).metadata()

  const desktopW = Math.min(2560, meta.width)
  const mobileW  = Math.min(1080, meta.width)

  await sharp(inputBuffer)
    .resize(desktopW, null, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85, effort: 4 })
    .toFile(path.join(dir, `${ts}-desktop.webp`))

  await sharp(inputBuffer)
    .resize(mobileW, null, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toFile(path.join(dir, `${ts}-mobile.webp`))

  const blurDataUrl = await generateBlurPlaceholder(inputBuffer)

  return {
    mediaUrl:    `/media/website/homepage/hero/${ts}-desktop.webp`,
    mobileUrl:   `/media/website/homepage/hero/${ts}-mobile.webp`,
    blurDataUrl,
  }
}

/**
 * Process a film thumbnail upload.
 * Generates 1280px WebP thumbnail + blur placeholder.
 *
 * @param {Buffer} inputBuffer
 * @param {number|string} filmId
 * @returns {Promise<{thumbnailUrl: string, thumbnailBlur: string}>}
 */
async function processFilmThumbnail(inputBuffer, filmId) {
  const dir = path.join(WEBSITE_MEDIA_DIR, 'films', String(filmId), 'thumb')
  ensureDir(dir)

  const ts  = Date.now()
  const meta = await sharp(inputBuffer).metadata()
  const w    = Math.min(1280, meta.width)

  await sharp(inputBuffer)
    .resize(w, null, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toFile(path.join(dir, `${ts}.webp`))

  const blurDataUrl = await generateBlurPlaceholder(inputBuffer)

  return {
    thumbnailUrl:  `/media/website/films/${filmId}/thumb/${ts}.webp`,
    thumbnailBlur: blurDataUrl,
  }
}

module.exports = {
  processStoryPhoto,
  processHeroImage,
  processFilmThumbnail,
  generateBlurPlaceholder,
  WEBSITE_MEDIA_DIR,
}
