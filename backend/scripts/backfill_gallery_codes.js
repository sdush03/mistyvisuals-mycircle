/**
 * Migration script to backfill unique 6-character alphanumeric join codes for all existing galleries.
 */
// Load environment variables from .env file if present
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
console.log("[backfill] Loading env from:", envPath, "exists:", fs.existsSync(envPath));
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/(^['"]|['"]$)/g, ''); // strip optional quotes
      if (key) {
        process.env[key] = val;
      }
    }
  });
}
if (!process.env.DATABASE_URL) {
  console.log("[backfill] DATABASE_URL is not set directly. Constructing from individual DB params...");
  const user = process.env.DB_USER || '';
  const password = process.env.DB_PASSWORD || '';
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const name = process.env.DB_NAME || '';
  const auth = password ? `${user}:${password}` : user;
  process.env.DATABASE_URL = `postgresql://${auth}@${host}:${port}/${name}`;
}

if (process.env.DATABASE_URL) {
  const masked = process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@');
  console.log("[backfill] DATABASE_URL is set:", masked);
} else {
  console.log("[backfill] DATABASE_URL is NOT set!");
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function generateUniqueCode() {
  while (true) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const existing = await prisma.galleryEvent.findFirst({
      where: {
        OR: [
          { fullCode: code },
          { partialCode: code }
        ]
      }
    });
    if (!existing) return code;
  }
}

async function main() {
  const galleries = await prisma.galleryEvent.findMany({
    where: {
      OR: [
        { fullCode: null },
        { partialCode: null }
      ]
    }
  });

  console.log(`Found ${galleries.length} galleries requiring passcode backfill...`);

  let count = 0;
  for (const gallery of galleries) {
    const fullCode = gallery.fullCode || await generateUniqueCode();
    
    let partialCode = gallery.partialCode;
    if (!partialCode) {
      while (true) {
        const candidate = await generateUniqueCode();
        if (candidate !== fullCode) {
          partialCode = candidate;
          break;
        }
      }
    }

    await prisma.galleryEvent.update({
      where: { id: gallery.id },
      data: {
        fullCode,
        partialCode
      }
    });

    console.log(`Updated gallery ${gallery.id} ("${gallery.title}"): fullCode=${fullCode}, partialCode=${partialCode}`);
    count++;
  }

  console.log(`Successfully backfilled codes for ${count} galleries.`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
