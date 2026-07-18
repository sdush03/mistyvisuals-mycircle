/**
 * Migration script to backfill unique 6-character alphanumeric join codes for all existing galleries.
 */
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
