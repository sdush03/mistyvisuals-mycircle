/**
 * createProjectFromLead.js
 *
 * Shared utility called from BOTH Razorpay webhook and manual conversion paths.
 * Accepts (leadId, pgClient) where pgClient is an active transaction client.
 *
 * Sources events + deliverables from the ProposalSnapshot (the legally signed version),
 * falling back to lead_events and quote_pricing_items only when the snapshot yields nothing.
 */

const { pool } = require('../db')
const { createInvoiceFromSnapshot } = require('./createInvoiceFromSnapshot')

// ── Deliverable type classifier ──────────────────────────────
function classifyDeliverableType(name) {
  if (!name) return 'other'
  const n = name.toLowerCase()
  if (n.includes('album')) return 'album'
  if (n.includes('teaser')) return 'teaser'
  if (n.includes('highlight')) return 'highlight'
  if (n.includes('reel')) return 'reels'
  if (n.includes('raw') || n.includes('data')) return 'raw_data'
  return 'other'
}

// ── Default checklist items ──────────────────────────────────
const DEFAULT_CHECKLIST = [
  { title: 'Client briefing call done', phase: 'pre_shoot' },
  { title: 'Shot list / preferences noted', phase: 'pre_shoot' },
  { title: 'Team assigned for all events', phase: 'pre_shoot' },
  { title: 'Gear checklist confirmed', phase: 'pre_shoot' },
  { title: 'Venue logistics confirmed', phase: 'pre_shoot' },
  { title: 'All team members reached venue', phase: 'shoot_day' },
  { title: 'Memory cards formatted and ready', phase: 'shoot_day' },
  { title: 'Data backed up after shoot', phase: 'shoot_day' },
  { title: 'Raw data transferred to system', phase: 'post_shoot' },
  { title: 'Culling started', phase: 'post_shoot' },
  { title: 'Client preview sent', phase: 'post_shoot' },
  { title: 'Final delivery done', phase: 'post_shoot' },
]

function formatLocalYMD(rawDate) {
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  if (isNaN(parsed.getTime())) {
    return rawDate.toString().slice(0, 10);
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getProjectName(lead) {
  const bride = (lead.bride_name || '').trim();
  const groom = (lead.groom_name || '').trim();
  
  if (bride && groom) {
    const brideFirst = bride.split(/\s+/)[0];
    const groomFirst = groom.split(/\s+/)[0];
    return `${brideFirst} ${groomFirst}`;
  } else if (bride) {
    return bride.split(/\s+/)[0];
  } else if (groom) {
    return groom.split(/\s+/)[0];
  }
  
  return lead.name || `Project #${lead.id}`;
}

async function generateUniqueSlug(lead, client, parsedEvents, leadId) {
  // Try to get wedding date from events
  const weddingEvent = parsedEvents.find(e => {
    const type = (e.event_type || '').toLowerCase();
    return type.includes('wedding') || type.includes('marriage');
  }) || parsedEvents[0] || null;

  let eventDate = null;
  if (weddingEvent && weddingEvent.event_date) {
    eventDate = new Date(weddingEvent.event_date);
  }

  // Fallback to lead creation date if no valid event date
  if (!eventDate || isNaN(eventDate.getTime())) {
    const createdRes = await client.query(`SELECT created_at FROM leads WHERE id = $1`, [leadId]);
    if (createdRes.rows.length && createdRes.rows[0].created_at) {
      eventDate = new Date(createdRes.rows[0].created_at);
    } else {
      eventDate = new Date();
    }
  }

  // Extract month (3-char lowercase) and year (2-char)
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mon = monthNames[eventDate.getMonth()];
  const yy = eventDate.getFullYear().toString().slice(-2);

  // Form name base (e.g. "Priya & Arjun" -> "priya-arjun")
  let nameBase = '';
  const bride = (lead.bride_name || '').trim();
  const groom = (lead.groom_name || '').trim();
  if (bride && groom) {
    const brideFirst = bride.split(/\s+/)[0];
    const groomFirst = groom.split(/\s+/)[0];
    nameBase = `${brideFirst}-${groomFirst}`;
  } else if (bride) {
    nameBase = bride.split(/\s+/)[0];
  } else if (groom) {
    nameBase = groom.split(/\s+/)[0];
  } else {
    nameBase = (lead.name || `lead-${leadId}`);
  }
  
  nameBase = nameBase.toLowerCase()
    .replace(/[^a-z0-9\s&-]/g, '') // remove special chars except spaces, & and -
    .replace(/\s*(?:&|and)\s*/g, '-') // replace & or and with hyphen
    .replace(/\s+/g, '-') // replace spaces with hyphens
    .trim();

  // clean up multiple hyphens
  nameBase = nameBase.replace(/-+/g, '-');

  let baseSlug = `${nameBase}-${mon}${yy}`;

  // Reserved slugs list
  const RESERVED_SLUGS = [
    'login', 'logout', 'leads', 'projects', 'admin', 'api', 'approvals',
    'insights', 'sales', 'vendor', 'privacy', 'terms', 'refund',
    'follow-ups', 'contact', 'fb-ads', 'proposalanalytics', 'proforma', 'me'
  ];

  let slug = baseSlug;
  let counter = 0;

  while (true) {
    // Check if it is a reserved slug
    if (RESERVED_SLUGS.includes(slug)) {
      counter++;
      slug = `${baseSlug}-${counter}`;
      continue;
    }

    // Check uniqueness in database
    const checkRes = await client.query(
      `SELECT id FROM projects WHERE slug = $1`,
      [slug]
    );

    if (checkRes.rows.length === 0) {
      break; // Found unique slug!
    }

    counter++;
    slug = `${baseSlug}-${counter}`;
  }

  return slug;
}

async function generatePasscode(lead) {
  const phone = lead.phone_primary;
  if (phone) {
    const digits = phone.replace(/\D/g, ''); // keep only numbers
    if (digits.length >= 4) {
      return digits.slice(-4);
    }
  }

  // Fallback to random 4 digits
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Main conversion function.
 * @param {number} leadId
 * @param {import('pg').PoolClient} client - active transaction client
 * @returns {Promise<string>} project UUID
 */
async function createProjectFromLead(leadId, client) {
  // ── 1. Guard: idempotent — return existing project if already created ───
  const existing = await client.query(
    `SELECT id FROM projects WHERE lead_id = $1`,
    [leadId]
  )
  if (existing.rows.length > 0) {
    console.log(`[projects] Project already exists for lead ${leadId}, returning existing id`)
    return { projectId: existing.rows[0].id, invoiceResult: null }
  }

  // ── 2. Fetch lead row ──────────────────────────────────────
  const leadRes = await client.query(
    `SELECT id, name, is_destination, phone_primary, bride_name, groom_name FROM leads WHERE id = $1`,
    [leadId]
  )
  if (!leadRes.rows.length) {
    throw new Error(`[projects] Lead ${leadId} not found`)
  }
  const lead = leadRes.rows[0]
  
  // Try to get primary city
  const cityRes = await client.query(
    `SELECT c.name FROM lead_cities lc 
     JOIN cities c ON c.id = lc.city_id 
     WHERE lc.lead_id = $1 AND lc.is_primary = true 
     LIMIT 1`,
    [leadId]
  )
  lead.city = cityRes.rows.length ? cityRes.rows[0].name : null

  console.log(`[projects] Converting lead ${leadId} (${lead.name}) to project`)

  // ── 3. Find the signed quote version ───────────────────────
  const qvRes = await client.query(
    `SELECT qv.id, qv.quote_group_id, qv.version_number, qv.status
     FROM quote_versions qv
     JOIN quote_groups qg ON qg.id = qv.quote_group_id
     WHERE qg.lead_id = $1
       AND qv.status IN ('ACCEPTED', 'ADVANCE_AWAITING')
     ORDER BY qv.version_number DESC
     LIMIT 1`,
    [leadId]
  )
  const signedVersion = qvRes.rows[0] || null
  const quoteGroupId = signedVersion?.quote_group_id || null
  const quoteVersionId = signedVersion?.id || null

  // ── 4. Find the proposal snapshot ──────────────────────────
  let snapshotId = null
  let snapshotJson = null

  if (quoteVersionId) {
    const snapRes = await client.query(
      `SELECT id, snapshot_json FROM proposal_snapshots
       WHERE quote_version_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [quoteVersionId]
    )
    if (snapRes.rows.length) {
      snapshotId = snapRes.rows[0].id
      snapshotJson = snapRes.rows[0].snapshot_json
      // Handle stringified JSON
      if (typeof snapshotJson === 'string') {
        try { snapshotJson = JSON.parse(snapshotJson) } catch { snapshotJson = null }
      }
    }
  }

  console.log(`[projects] Signed version: ${quoteVersionId || 'none'}, snapshot: ${snapshotId || 'none'}`)

  // ── 5. Extract events from snapshot ────────────────────────
  let parsedEvents = []

  if (snapshotJson) {
    // Events are stored at snapshotJson.draftData.events
    const draftData = snapshotJson.draftData || snapshotJson.draft_data || {}
    const snapshotEvents = draftData.events || []

    parsedEvents = snapshotEvents
      .filter(e => e && (e.date || e.event_date))
      .map(e => {
        let startTime = e.start_time || e.startTime || null;
        let endTime = e.end_time || e.endTime || null;
        
        // If they just provided "time": "10:00 AM - 2:00 PM"
        if (!startTime && !endTime && e.time) {
          const parts = e.time.split('-').map(s => s.trim());
          if (parts.length === 2) {
            startTime = parts[0];
            endTime = parts[1];
          } else {
            startTime = e.time;
          }
        }

        const origType = (e.originalType || '').trim();
        const customName = (e.name || e.event_type || e.eventType || e.type || '').trim();
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

        return {
          event_type: resolvedType,
          event_date: formatLocalYMD(e.date || e.event_date),
          pax: e.pax ? Number(e.pax) : null,
          venue: e.venue || e.venueName || e.location || null,
          venue_address: e.venueAddress || e.venue_address || null,
          start_time: startTime,
          end_time: endTime,
          slot: e.slot || null,
        }
      })

    console.log(`[projects] Extracted ${parsedEvents.length} events from snapshot`)
  }

  // ── 5b. Try to back-reference lead_event_id for each parsed event ────
  let leadEventsMap = new Map()
  if (parsedEvents.length > 0) {
    const leRes = await client.query(
      `SELECT id, event_type, event_date FROM lead_events WHERE lead_id = $1`,
      [leadId]
    )
    for (const le of leRes.rows) {
      const dateStr = le.event_date ? le.event_date.toISOString().slice(0, 10) : ''
      const key = `${dateStr}_${(le.event_type || '').toLowerCase()}`
      leadEventsMap.set(key, le.id)
    }
  }

  // Attach lead_event_id to each parsed event
  for (const pe of parsedEvents) {
    const key = `${pe.event_date || ''}_${(pe.event_type || '').toLowerCase()}`
    pe.lead_event_id = leadEventsMap.get(key) || null
  }

  // ── 7. Fallback: use lead_events directly if snapshot yielded 0 ────
  if (parsedEvents.length === 0) {
    console.log(`[projects] No events from snapshot, falling back to lead_events`)
    const leRes = await client.query(
      `SELECT id, event_type, event_date, pax, venue, start_time, end_time, slot
       FROM lead_events WHERE lead_id = $1
       ORDER BY event_date ASC`,
      [leadId]
    )
    parsedEvents = leRes.rows.map(e => ({
      lead_event_id: e.id,
      event_type: e.event_type,
      event_date: e.event_date ? e.event_date.toISOString().slice(0, 10) : null,
      pax: e.pax ? Number(e.pax) : null,
      venue: e.venue,
      venue_address: null,
      start_time: e.start_time,
      end_time: e.end_time,
      slot: e.slot,
    }))
    console.log(`[projects] Fallback yielded ${parsedEvents.length} events from lead_events`)
  }

  // ── 6. Extract deliverables from snapshot ──────────────────
  let parsedDeliverables = []

  if (snapshotJson) {
    const draftData = snapshotJson.draftData || snapshotJson.draft_data || {}

    // Try deliverables array in draftData first
    const draftDeliverables = draftData.deliverables || []
    if (draftDeliverables.length > 0) {
      parsedDeliverables = draftDeliverables
        .map(d => ({
          title: (d.label || d.title || d.name || '').trim(),
          type: classifyDeliverableType(d.label || d.title || d.name),
          quantity: d.quantity || d.qty || 1,
        }))
        .filter(d => d.title.length > 0)
    }

    // Also extract from snapshot.items of type DELIVERABLE
    if (parsedDeliverables.length === 0) {
      const snapshotItems = snapshotJson.items || []
      const deliverableItems = snapshotItems.filter(
        i => i.itemType === 'DELIVERABLE' || i.type === 'DELIVERABLE'
      )
      parsedDeliverables = deliverableItems.map(d => ({
        title: (d.name || d.label || '').trim() || 'Deliverable',
        type: classifyDeliverableType(d.name || d.label),
        quantity: d.quantity || 1,
      })).filter(d => d.title.length > 0)
    }

    console.log(`[projects] Extracted ${parsedDeliverables.length} deliverables from snapshot`)
  }

  // ── 8. Fallback: use quote_pricing_items + deliverable_catalog ─────
  if (parsedDeliverables.length === 0 && quoteVersionId) {
    console.log(`[projects] No deliverables from snapshot, falling back to quote_pricing_items`)
    const qpiRes = await client.query(
      `SELECT qpi.quantity, dc.name, dc.category
       FROM quote_pricing_items qpi
       JOIN deliverable_catalog dc ON dc.id = qpi.catalog_id
       WHERE qpi.quote_version_id = $1
         AND qpi.item_type = 'DELIVERABLE'`,
      [quoteVersionId]
    )
    parsedDeliverables = qpiRes.rows.map(r => ({
      title: r.name,
      type: classifyDeliverableType(r.name),
      quantity: r.quantity || 1,
    }))
    console.log(`[projects] Fallback yielded ${parsedDeliverables.length} deliverables`)
  }

  // ── 9. Derive start_date and end_date ──────────────────────
  const validDates = parsedEvents
    .map(e => e.event_date)
    .filter(d => d && d !== '2099-01-01')
    .sort()

  const startDate = validDates[0] || null
  const endDate = validDates[validDates.length - 1] || null

  const slug = await generateUniqueSlug(lead, client, parsedEvents, leadId);
  const passcode = await generatePasscode(lead);

  const projectName = getProjectName(lead);

  // ── 10. INSERT project ─────────────────────────────────────
  const projRes = await client.query(
    `INSERT INTO projects (lead_id, quote_group_id, quote_version_id, proposal_snapshot_id, name, status, start_date, end_date, city, is_destination, slug, passcode)
     VALUES ($1, $2, $3, $4, $5, 'upcoming', $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      leadId,
      quoteGroupId,
      quoteVersionId,
      snapshotId,
      projectName,
      startDate,
      endDate,
      lead.city || null,
      lead.is_destination || false,
      slug,
      passcode,
    ]
  )
  const projectId = projRes.rows[0].id
  console.log(`[projects] Created project ${projectId} for lead ${leadId}`)

  // ── 11. INSERT project_events ──────────────────────────────
  for (const ev of parsedEvents) {
    await client.query(
      `INSERT INTO project_events (project_id, lead_event_id, event_type, event_date, pax, venue, venue_address, start_time, end_time, slot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        projectId,
        ev.lead_event_id || null,
        ev.event_type,
        ev.event_date,
        ev.pax,
        ev.venue,
        ev.venue_address || null,
        ev.start_time,
        ev.end_time,
        ev.slot,
      ]
    )
  }
  console.log(`[projects] Inserted ${parsedEvents.length} project events`)

  // ── 12. INSERT project_deliverables ────────────────────────
  for (const del of parsedDeliverables) {
    await client.query(
      `INSERT INTO project_deliverables (project_id, title, type, quantity)
       VALUES ($1, $2, $3, $4)`,
      [projectId, del.title, del.type, del.quantity]
    )
  }
  console.log(`[projects] Inserted ${parsedDeliverables.length} project deliverables`)

  // ── 13. INSERT default checklist ───────────────────────────
  for (const item of DEFAULT_CHECKLIST) {
    await client.query(
      `INSERT INTO project_checklist (project_id, title, phase)
       VALUES ($1, $2, $3)`,
      [projectId, item.title, item.phase]
    )
  }
  console.log(`[projects] Inserted ${DEFAULT_CHECKLIST.length} checklist items`)

  // ── 14. Create Invoice ──────────────────────────────────────
  let invoiceResult = null;
  if (snapshotId) {
    invoiceResult = await createInvoiceFromSnapshot(
      projectId, 
      leadId, 
      snapshotId,   
      client                 
    );
    console.log('[projects] Invoice created:', invoiceResult)
  }

  // ── 15. Auto-create Gallery Event (idempotent, keyed on project UUID) ─────
  // projectId is the stable identifier — if the project slug ever changes,
  // this upsert will find the existing gallery and NOT create a duplicate.
  try {
    await client.query('SAVEPOINT gallery_savepoint');
    const galleryTitle = projectName;
    const galleryDate = startDate ? new Date(startDate) : new Date();
    const qrToken = `${slug}_qr`;

    const existingGallery = await client.query('SELECT id FROM gallery_events WHERE project_id = $1', [String(projectId)]);
    if (existingGallery.rows.length === 0) {
      await client.query(`
        INSERT INTO gallery_events (slug, project_id, title, date, qr_token, lead_id, active)
        VALUES ($1, $2, $3, $4, $5, $6, true)
      `, [slug, String(projectId), galleryTitle, galleryDate, qrToken, leadId ? parseInt(leadId, 10) : null]);
    }
    await client.query('RELEASE SAVEPOINT gallery_savepoint');
    console.log(`[projects] Gallery event created/verified for project "${projectId}" (slug: "${slug}")`);
  } catch (galleryErr) {
    // Non-fatal: log but don't fail the project creation
    try {
      await client.query('ROLLBACK TO SAVEPOINT gallery_savepoint');
    } catch (savepointErr) {
      // Ignore if transaction already aborted before savepoint could be rolled back
    }
    console.error('[projects] Failed to auto-create gallery event:', galleryErr.message);
  }

  // ── 16. Return project id and invoice info ─────────────────
  return { projectId, invoiceResult }
}

module.exports = { createProjectFromLead }
