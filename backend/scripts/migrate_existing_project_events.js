require('dotenv').config({ path: '.env' });
const { pool } = require('../db.js');

async function run() {
  console.log("Starting migration of existing project events...");
  
  // 1. Get all projects
  const projRes = await pool.query("SELECT id, name, slug, proposal_snapshot_id, lead_id FROM projects");
  console.log(`Found ${projRes.rows.length} projects to check.`);

  for (const proj of projRes.rows) {
    console.log(`\nChecking project: ${proj.slug} (ID: ${proj.id})`);
    
    // Fetch project events currently in DB
    const evRes = await pool.query("SELECT id, event_type, event_date FROM project_events WHERE project_id = $1", [proj.id]);
    console.log(`Current project events in DB:`, evRes.rows.map(r => ({ id: r.id, event_type: r.event_type, date: r.event_date })));

    if (!proj.proposal_snapshot_id) {
      console.log(`Project has no proposal snapshot, skipping or manual check not needed.`);
      continue;
    }

    // Fetch snapshot
    const snapRes = await pool.query("SELECT snapshot_json FROM proposal_snapshots WHERE id = $1", [proj.proposal_snapshot_id]);
    if (snapRes.rows.length === 0) {
      console.log(`Warning: Snapshot ${proj.proposal_snapshot_id} not found in DB!`);
      continue;
    }

    const snapJson = snapRes.rows[0].snapshot_json;
    const parsedSnap = typeof snapJson === 'string' ? JSON.parse(snapJson) : snapJson;
    const draftData = parsedSnap.draftData || parsedSnap.draft_data || {};
    const snapshotEvents = draftData.events || [];
    console.log(`Snapshot events found:`, snapshotEvents.map(e => ({ name: e.name, originalType: e.originalType, date: e.date || e.event_date })));

    // Helper to format date YYYY-MM-DD
    function formatLocalYMD(dateVal) {
      if (!dateVal) return null;
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return null;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    for (const snapEv of snapshotEvents) {
      if (!snapEv || (!snapEv.date && !snapEv.event_date)) continue;
      
      const snapDate = formatLocalYMD(snapEv.date || snapEv.event_date);
      const origType = (snapEv.originalType || '').trim();
      const customName = (snapEv.name || snapEv.event_type || snapEv.eventType || snapEv.type || '').trim();
      
      let resolvedType = null;
      if (origType) {
        const hasGroomOrBride = /\(\s*(groom|bride)\s*\)/i.test(origType);
        if (hasGroomOrBride && customName) {
          resolvedType = customName;
        } else {
          resolvedType = origType;
        }
      } else {
        resolvedType = customName || null;
      }

      if (!resolvedType) continue;

      // Find matching project event.
      const matchingProjEv = evRes.rows.find(pe => {
        const peDate = pe.event_date ? formatLocalYMD(pe.event_date) : '';
        return peDate === snapDate;
      });

      if (matchingProjEv) {
        if (matchingProjEv.event_type !== resolvedType) {
          console.log(`Updating event ID ${matchingProjEv.id}: "${matchingProjEv.event_type}" -> "${resolvedType}"`);
          await pool.query("UPDATE project_events SET event_type = $1 WHERE id = $2", [resolvedType, matchingProjEv.id]);
        } else {
          console.log(`Event ID ${matchingProjEv.id} is already correct: "${resolvedType}"`);
        }
      } else {
        console.log(`Could not find a project event matching date ${snapDate}`);
      }
    }
  }

  console.log("\nMigration completed successfully.");
  process.exit(0);
}

run().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
