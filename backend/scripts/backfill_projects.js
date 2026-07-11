require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../db.js');
const { createProjectFromLead } = require('../utils/createProjectFromLead');

async function run() {
  console.log("Starting backfill of projects for converted leads...");

  // 1. Fetch all leads with status 'Converted'
  const leadsRes = await pool.query(
    "SELECT id, name FROM leads WHERE status = 'Converted' ORDER BY id DESC"
  );
  console.log(`Found ${leadsRes.rows.length} converted leads in database.`);

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const lead of leadsRes.rows) {
    // 2. Check if a project already exists for this lead
    const projRes = await pool.query(
      "SELECT id FROM projects WHERE lead_id = $1",
      [lead.id]
    );

    if (projRes.rows.length > 0) {
      console.log(`[Lead ${lead.id}] Project already exists (ID: ${projRes.rows[0].id}). Skipping.`);
      skippedCount++;
      continue;
    }

    console.log(`[Lead ${lead.id}] No project found for converted lead "${lead.name}". Creating...`);

    // 3. Connect transaction client and run creation logic
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await createProjectFromLead(lead.id, client);
      await client.query('COMMIT');
      console.log(`[Lead ${lead.id}] Project created successfully!`);
      createdCount++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[Lead ${lead.id}] Failed to create project:`, err.message || err);
      errorCount++;
    } finally {
      client.release();
    }
  }

  console.log("\n==========================================");
  console.log(`Backfill finished:`);
  console.log(`- Created: ${createdCount}`);
  console.log(`- Skipped: ${skippedCount}`);
  console.log(`- Errors:  ${errorCount}`);
  console.log("==========================================");
  process.exit(0);
}

run().catch(err => {
  console.error("Backfill script error:", err);
  process.exit(1);
});
