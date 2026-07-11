const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
require('dotenv').config();

const prisma = new PrismaClient();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  console.log('Starting migration to backfill tabs array for existing galleries...');
  const galleries = await prisma.galleryEvent.findMany();
  console.log(`Found ${galleries.length} total galleries to check.`);

  for (const gallery of galleries) {
    const existingTabs = new Set(gallery.tabs || []);

    // 1. Get tabs from already uploaded photos
    const photos = await prisma.photo.findMany({
      where: { eventId: gallery.id },
      select: { tabName: true }
    });
    photos.forEach(p => {
      if (p.tabName) existingTabs.add(p.tabName);
    });

    // 2. Get tabs from CRM project events (if leadId present)
    if (gallery.leadId) {
      try {
        const projRes = await pool.query(
          `SELECT id FROM projects WHERE lead_id = $1 LIMIT 1`,
          [gallery.leadId]
        );
        if (projRes.rows.length) {
          const projectId = projRes.rows[0].id;
          const eventsRes = await pool.query(
            `SELECT event_type FROM project_events WHERE project_id = $1`,
            [projectId]
          );
          eventsRes.rows.forEach(e => {
            if (e.event_type) existingTabs.add(e.event_type);
          });
        }
      } catch (err) {
        console.error(`Error querying CRM events for leadId ${gallery.leadId}:`, err.message);
      }
    }

    const mergedTabs = Array.from(existingTabs);
    console.log(`Gallery ID ${gallery.id} (${gallery.title}): setting tabs to [${mergedTabs.join(', ')}]`);

    await prisma.galleryEvent.update({
      where: { id: gallery.id },
      data: { tabs: mergedTabs }
    });
  }

  console.log('Migration successfully completed!');
}

main()
  .catch(err => {
    console.error('Fatal error during migration:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
