/**
 * Migration: Add "Highlights" as the first tab to all existing galleries.
 * Safe to run multiple times (idempotent).
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const galleries = await prisma.galleryEvent.findMany({ select: { id: true, title: true, tabs: true } });

  let updated = 0;
  for (const gallery of galleries) {
    if (gallery.tabs.includes('Highlights')) {
      console.log(`✓ [${gallery.id}] "${gallery.title}" already has Highlights`);
      continue;
    }

    const newTabs = ['Highlights', ...gallery.tabs];
    await prisma.galleryEvent.update({
      where: { id: gallery.id },
      data: { tabs: newTabs }
    });

    console.log(`✅ [${gallery.id}] "${gallery.title}": added Highlights → [${newTabs.join(', ')}]`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated} / ${galleries.length} galleries.`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
