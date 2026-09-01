const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const fs = require('fs');
const path = require('path');
const { PHOTO_UPLOAD_DIR } = require('../config/constants');

const isR2Enabled = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET_NAME &&
  process.env.R2_PUBLIC_DOMAIN_URL
);
// Read client — used for GetObject (resize/fetch). Large pool for concurrent thumbnail loads.
let r2Client = null;
// Write client — used for PutObject/DeleteObject (uploads, selfies). Dedicated pool so
// a thumbnail flood can never starve selfie uploads or photo processing.
let r2WriteClient = null;

const r2Config = isR2Enabled ? {
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  },
  region: 'auto',
} : null;

if (isR2Enabled) {
  // 400 sockets for reads — handles concurrent gallery thumbnail fetches
  r2Client = new S3Client({
    ...r2Config,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 30000,
      socketTimeout: 30000,
      maxSockets: 400,
    }),
  });

  // 100 sockets reserved exclusively for writes (selfie uploads, photo uploads, deletes)
  r2WriteClient = new S3Client({
    ...r2Config,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 30000,
      socketTimeout: 60000, // longer timeout for large file uploads
      maxSockets: 100,
    }),
  });
}

/**
 * Uploads a file buffer to Cloudflare R2 if configured, or saves it to local disk in development mode.
 * @param {Buffer} buffer - File data buffer
 * @param {string} filename - Target filename
 * @param {string} subfolder - Organized subdirectory path (e.g. 'events/slug/photos')
 * @param {string} contentType - Mime type of the file
 * @returns {Promise<string>} The public URL of the uploaded asset
 */
async function uploadAsset(buffer, filename, subfolder, contentType = 'image/jpeg') {
  const key = subfolder ? `${subfolder}/${filename}` : filename;

  if (isR2Enabled) {
    const uploadParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable'
    };
    await r2WriteClient.send(new PutObjectCommand(uploadParams));
    
    // Remove protocol double-slashes in custom domain if user provided https:// prefix in env
    let publicDomain = process.env.R2_PUBLIC_DOMAIN_URL.trim();
    if (publicDomain.startsWith('http://')) publicDomain = publicDomain.substring(7);
    if (publicDomain.startsWith('https://')) publicDomain = publicDomain.substring(8);
    
    return `https://${publicDomain}/${key}`;
  } else {
    // Only allow local disk fallback in development mode
    if (process.env.NODE_ENV === 'production') {
      throw new Error('R2 storage is not configured/enabled. Local fallback is disabled in production.');
    }

    const targetDir = path.join(PHOTO_UPLOAD_DIR, subfolder || '');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const destPath = path.join(targetDir, filename);
    fs.writeFileSync(destPath, buffer);
    return `/api/photos/file/${key}`;
  }
}

/**
 * Uploads a file buffer to Cloudflare R2 with exponential backoff retry.
 * Unlike uploadAsset, this throws on all failures — no silent local fallback.
 * @param {Buffer} buffer - File data buffer
 * @param {string} filename - Target filename
 * @param {string} subfolder - Organized subdirectory path
 * @param {string} contentType - Mime type of the file
 * @param {number} maxRetries - Maximum number of attempts (default: 3)
 * @returns {Promise<string>} The public URL of the uploaded asset
 */
async function uploadAssetWithRetry(buffer, filename, subfolder, contentType = 'image/jpeg', maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await uploadAsset(buffer, filename, subfolder, contentType);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        console.warn(`[R2 Upload] Attempt ${attempt}/${maxRetries} failed for ${subfolder}/${filename}. Retrying in ${delayMs}ms...`, err.message);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new Error(`[R2 Upload] All ${maxRetries} attempts failed for ${subfolder}/${filename}: ${lastErr?.message}`);
}

/**
 * Deletes an asset from Cloudflare R2, or removes it from local disk in development mode.

 * @param {string} fileUrl - Public URL or local routing path
 * @returns {Promise<void>}
 */
async function deleteAsset(fileUrl) {
  if (!fileUrl) return;

  if (isR2Enabled) {
    // Extract key from public URL (everything after domain)
    let key = '';
    try {
      const parsed = new URL(fileUrl);
      key = decodeURIComponent(parsed.pathname.substring(1)); // strip leading slash and decode
    } catch (e) {
      // Fallback: parse relative path if not a valid URL
      key = decodeURIComponent(fileUrl.replace(/^\/?api\/photos\/file\//, ''));
    }
    if (key) {
      const deleteParams = {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key
      };
      try {
        await r2WriteClient.send(new DeleteObjectCommand(deleteParams));
      } catch (err) {
        console.error(`[R2 Delete Error] Failed to delete asset: ${key}`, err);
      }
    }
  } else {
    // Only allow local disk fallback in development mode
    if (process.env.NODE_ENV === 'production') {
      throw new Error('R2 storage is not configured/enabled. Local fallback is disabled in production.');
    }

    const relativePath = decodeURIComponent(fileUrl.replace(/^\/?api\/photos\/file\//, ''));
    const filePath = path.normalize(path.join(PHOTO_UPLOAD_DIR, relativePath));
    if (filePath.startsWith(PHOTO_UPLOAD_DIR) && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`[Local Delete Error] Failed to delete file: ${filePath}`, err);
      }
    }
  }
}

async function getPresignedUploadUrl(key, contentType = 'image/jpeg') {
  if (isR2Enabled) {
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable'
    });
    return await getSignedUrl(r2Client, command, { expiresIn: 3600 });
  } else {
    // Local development fallback URL
    return `/api/photos/file/${key}`;
  }
}
async function getObjectStream(key) {
  if (isR2Enabled) {
    const response = await r2Client.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key
    }));
    return response.Body;
  } else {
    // Only allow local disk fallback in development mode
    if (process.env.NODE_ENV === 'production') {
      throw new Error('R2 storage is not configured. Local fallback is disabled in production.');
    }
    const filePath = path.normalize(path.join(PHOTO_UPLOAD_DIR, key));
    if (filePath.startsWith(PHOTO_UPLOAD_DIR) && fs.existsSync(filePath)) {
      return fs.createReadStream(filePath);
    }
    throw new Error('File not found');
  }
}

module.exports = {
  isR2Enabled,
  uploadAsset,
  uploadAssetWithRetry,
  deleteAsset,
  getPresignedUploadUrl,
  getObjectStream
};
