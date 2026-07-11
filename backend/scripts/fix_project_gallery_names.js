/**
 * One-time migration: Fix project names (remove " & ") and gallery titles (remove "'s Wedding").
 * Format: "Pooja Raj" not "Pooja & Raj's Wedding"
 */
require('dotenv').config();
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient();

async function fix() {
  // ── Fix project names ──────────────────────────────────────
  const projects = await pool.query(`
    SELECT p.id, p.name, l.bride_name, l.groom_name
    FROM projects p
    LEFT JOIN leads l ON l.id = p.lead_id
  `);

  console.log(`Checking ${projects.rows.length} projects...`);
  for (const p of projects.rows) {
    const bride = (p.bride_name || '').trim();
    const groom = (p.groom_name || '').trim();
    let newName = p.name;

    if (bride && groom) {
      const brideFirst = bride.split(/\s+/)[0];
      const groomFirst = groom.split(/\s+/)[0];
      newName = `${brideFirst} ${groomFirst}`;
    } else {
      // Generic cleanup: remove " & " and "'s Wedding"
      newName = p.name.replace(" & ", " ").replace("'s Wedding", "").trim();
    }

    if (newName !== p.name) {
      await pool.query('UPDATE projects SET name = $1 WHERE id = $2', [newName, p.id]);
      console.log(`  ✅ Project ${p.id}: "${p.name}" → "${newName}"`);
    } else {
      console.log(`  ✓  Project ${p.id}: "${p.name}" (no change)`);
    }
  }

  // ── Fix gallery titles ──────────────────────────────────────
  const galleries = await prisma.galleryEvent.findMany({ select: { id: true, title: true } });
  console.log(`\nChecking ${galleries.length} galleries...`);
  for (const g of galleries) {
    let newTitle = g.title.replace(" & ", " ").replace("'s Wedding", "").trim();

    if (newTitle !== g.title) {
      await prisma.galleryEvent.update({ where: { id: g.id }, data: { title: newTitle } });
      console.log(`  ✅ Gallery ${g.id}: "${g.title}" → "${newTitle}"`);
    } else {
      console.log(`  ✓  Gallery ${g.id}: "${g.title}" (no change)`);
    }
  }

  await pool.end();
  await prisma.$disconnect();
  console.log('\nDone!');
}

fix().catch(e => { console.error(e); process.exit(1); });
