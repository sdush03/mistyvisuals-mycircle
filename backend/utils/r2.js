const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const path = require('path');
const { PHOTO_UPLOAD_DIR } = require('../config/constants');

// Load environment variables for local testing
const isR2Enabled = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET_NAME &&
  process.env.R2_PUBLIC_DOMAIN_URL
);

let r2Client = null;
if (isR2Enabled) {
  r2Client = new S3Client({
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    },
    region: 'auto'
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
    await r2Client.send(new PutObjectCommand(uploadParams));
    
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
        await r2Client.send(new DeleteObjectCommand(deleteParams));
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

module.exports = {
  isR2Enabled,
  uploadAsset,
  deleteAsset,
  getPresignedUploadUrl
};
