const { prisma } = require('../prisma');
const { uploadAssetWithRetry, deleteAsset } = require('../utils/r2');
const path = require('path');

/**
 * Helper to ensure tags column exists in saved_photos
 */
let ensuredSchema = false;
async function ensureSchema(pool) {
  if (ensuredSchema) return;
  try {
    await pool.query(`
      ALTER TABLE saved_photos ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
      CREATE INDEX IF NOT EXISTS idx_saved_photos_tags ON saved_photos USING GIN(tags);
    `);
    ensuredSchema = true;
  } catch (err) {
    console.warn('[saves] Schema ensure warning:', err?.message);
  }
}

/**
 * Helper to resolve user context (userId, email, eventId, displayRole, isCouple)
 * Robust resolution checking JWT auth, circle_users, and guests tables.
 */
async function resolveUserContext(pool, req) {
  await ensureSchema(pool);

  const auth = req.auth || {};
  let userId = auth.sub || auth.id || auth.userId || null;
  let email = auth.email || req.query?.email || req.body?.email || null;
  let eventSlug = req.query?.eventSlug || req.body?.eventSlug || null;
  let eventId = req.query?.eventId || req.body?.eventId || auth.eventId || auth.event_id || null;
  let displayRole = req.query?.displayRole || req.body?.displayRole || auth.displayRole || null;

  // 1. If email is missing, lookup from circle_users by userId
  if (!email && userId) {
    try {
      const uRes = await pool.query(`SELECT email FROM circle_users WHERE id = $1 LIMIT 1`, [userId]);
      if (uRes.rows.length > 0 && uRes.rows[0].email) {
        email = uRes.rows[0].email;
      }
    } catch (err) {}
  }

  // 2. Resolve eventId from eventSlug if passed
  if (!eventId && eventSlug) {
    try {
      const evRes = await pool.query(`SELECT id FROM gallery_events WHERE slug = $1 LIMIT 1`, [eventSlug]);
      if (evRes.rows.length > 0) {
        eventId = evRes.rows[0].id;
      }
    } catch (err) {}
  }

  // 3. Lookup guest record in guests table (prioritize BRIDE or GROOM role)
  if (email) {
    try {
      let query;
      let params;
      if (eventId) {
        query = `SELECT event_id, display_role FROM guests 
                 WHERE LOWER(email) = LOWER($1) AND event_id = $2 AND status != 'LEFT' 
                 ORDER BY CASE WHEN display_role IN ('BRIDE', 'GROOM') THEN 1 ELSE 2 END, id DESC LIMIT 1`;
        params = [email, eventId];
      } else {
        query = `SELECT event_id, display_role FROM guests 
                 WHERE LOWER(email) = LOWER($1) AND status != 'LEFT' 
                 ORDER BY CASE WHEN display_role IN ('BRIDE', 'GROOM') THEN 1 ELSE 2 END, id DESC LIMIT 1`;
        params = [email];
      }
      const guestRes = await pool.query(query, params);
      if (guestRes.rows.length > 0) {
        if (!eventId) eventId = guestRes.rows[0].event_id;
        const gRole = (guestRes.rows[0].display_role || '').toString().toUpperCase();
        if (['BRIDE', 'GROOM'].includes(gRole)) {
          displayRole = gRole;
        } else if (!displayRole || ['GUEST', 'FAMILY'].includes(displayRole.toUpperCase())) {
          displayRole = gRole || 'GUEST';
        }
      }
    } catch (err) {
      console.warn('[saves] guest lookup error:', err?.message);
    }
  }

  // 4. Fallback lookup from previously saved photos
  if (!eventId && userId) {
    try {
      const saveRes = await pool.query(
        `SELECT event_id, display_role FROM saved_photos WHERE user_id = $1 AND event_id IS NOT NULL ORDER BY id DESC LIMIT 1`,
        [userId]
      );
      if (saveRes.rows.length > 0) {
        eventId = saveRes.rows[0].event_id;
        if (!displayRole || displayRole === 'GUEST') {
          displayRole = saveRes.rows[0].display_role;
        }
      }
    } catch (err) {}
  }

  const normalizedRole = (displayRole || '').toString().toUpperCase();
  const isCouple = normalizedRole === 'BRIDE' || normalizedRole === 'GROOM';

  return { userId, email, eventId, displayRole: isCouple ? normalizedRole : 'GUEST', isCouple };
}

/**
 * Normalizes tags array from string, JSON, or array
 */
function normalizeTags(rawTags) {
  if (!rawTags) return [];
  if (Array.isArray(rawTags)) {
    return rawTags.map(t => String(t).trim()).filter(Boolean);
  }
  if (typeof rawTags === 'string') {
    try {
      const parsed = JSON.parse(rawTags);
      if (Array.isArray(parsed)) return parsed.map(t => String(t).trim()).filter(Boolean);
    } catch (_) {}
    return rawTags.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

module.exports = async function savesRoutes(fastify, opts) {
  const { pool, requireAuth } = opts;

  // POST /api/saves - Save a story / featured photo (with optional tags)
  fastify.post('/api/saves', async (req, reply) => {
    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const { photoUrl, storyId, sourceType = 'FEATURED_STORY', tags = [] } = req.body || {};
    if (!photoUrl) {
      return reply.code(400).send({ error: 'photoUrl is required' });
    }

    const { userId, eventId, displayRole, isCouple } = await resolveUserContext(pool, req);
    const parsedTags = normalizeTags(tags);

    try {
      let result;
      // Couple (Bride/Groom): Save to shared wedding collection
      if (eventId && isCouple) {
        result = await pool.query(
          `INSERT INTO saved_photos (event_id, user_id, display_role, photo_url, story_id, source_type, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (event_id, photo_url, user_id)
           DO UPDATE SET display_role = EXCLUDED.display_role, tags = EXCLUDED.tags, created_at = NOW()
           RETURNING *`,
          [eventId, userId, displayRole, photoUrl, storyId || null, sourceType, parsedTags]
        );
      } else {
        // Regular guests: Save to personal private collection with event_id = NULL
        result = await pool.query(
          `INSERT INTO saved_photos (event_id, user_id, display_role, photo_url, story_id, source_type, tags)
           VALUES (NULL, $1, 'GUEST', $2, $3, $4, $5)
           RETURNING *`,
          [userId, photoUrl, storyId || null, sourceType, parsedTags]
        );
      }

      return reply.send({
        success: true,
        savedPhoto: result.rows[0]
      });
    } catch (err) {
      console.error('[saves] Error saving photo:', err);
      return reply.code(500).send({ error: 'Failed to save photo' });
    }
  });

  // POST /api/saves/upload - Upload custom inspiration photo from camera roll to R2
  fastify.post('/api/saves/upload', async (req, reply) => {
    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    try {
      const parts = req.parts();
      let fileBuffer = null;
      let filename = null;
      let mimeType = 'image/jpeg';
      const fields = {};

      for await (const part of parts) {
        if (part.file) {
          const chunks = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          fileBuffer = Buffer.concat(chunks);
          filename = part.filename || 'inspiration.jpg';
          mimeType = part.mimetype || 'image/jpeg';
        } else {
          fields[part.fieldname] = part.value;
        }
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        return reply.code(400).send({ error: 'No image file provided' });
      }

      // Inject fields into req.body / req.query for context resolution
      req.body = { ...fields, ...req.body };
      const { userId, eventId, displayRole, isCouple } = await resolveUserContext(pool, req);

      // STRICT PERMISSION: Only Bride and Groom can upload custom inspirations
      if (!isCouple || !eventId) {
        return reply.code(403).send({
          error: 'Moodboard uploads are an exclusive feature for couples. Hire MistyVisuals for your wedding to unlock this feature.'
        });
      }

      const parsedTags = normalizeTags(fields.tags || req.query?.tags);

      // Generate unique clean filename
      const ext = path.extname(filename) || '.jpg';
      const cleanFilename = `inspo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
      const subfolder = `moodboard/events/${eventId}`;

      // Upload file to Cloudflare R2
      const r2Url = await uploadAssetWithRetry(fileBuffer, cleanFilename, subfolder, mimeType);

      let result;
      if (eventId && isCouple) {
        result = await pool.query(
          `INSERT INTO saved_photos (event_id, user_id, display_role, photo_url, story_id, source_type, tags)
           VALUES ($1, $2, $3, $4, NULL, 'MANUAL_UPLOAD', $5)
           RETURNING *`,
          [eventId, userId, displayRole, r2Url, parsedTags]
        );
      } else {
        result = await pool.query(
          `INSERT INTO saved_photos (event_id, user_id, display_role, photo_url, story_id, source_type, tags)
           VALUES (NULL, $1, 'GUEST', $2, NULL, 'MANUAL_UPLOAD', $3)
           RETURNING *`,
          [userId, r2Url, parsedTags]
        );
      }

      return reply.send({
        success: true,
        savedPhoto: result.rows[0]
      });
    } catch (err) {
      console.error('[saves] Error uploading inspiration photo:', err);
      return reply.code(500).send({ error: 'Failed to upload inspiration photo' });
    }
  });

  // PATCH /api/saves/:id/tags - Update tags for an existing saved photo
  fastify.patch('/api/saves/:id/tags', async (req, reply) => {
    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { tags } = req.body || {};
    const { userId, eventId, isCouple } = await resolveUserContext(pool, req);
    const parsedTags = normalizeTags(tags);

    try {
      let query;
      let params;
      if (eventId && isCouple) {
        query = `UPDATE saved_photos SET tags = $1 WHERE id = $2 AND (user_id = $3 OR event_id = $4) RETURNING *`;
        params = [parsedTags, Number(id), userId, eventId];
      } else {
        query = `UPDATE saved_photos SET tags = $1 WHERE id = $2 AND user_id = $3 RETURNING *`;
        params = [parsedTags, Number(id), userId];
      }

      const result = await pool.query(query, params);
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Saved photo not found or not authorized' });
      }

      return reply.send({ success: true, savedPhoto: result.rows[0] });
    } catch (err) {
      console.error('[saves] Error updating tags:', err);
      return reply.code(500).send({ error: 'Failed to update tags' });
    }
  });

  // DELETE /api/saves - Remove a saved photo (Safe delete: only deletes user custom uploads from R2)
  fastify.delete('/api/saves', async (req, reply) => {
    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const { photoUrl, id } = req.query || {};
    const { userId, eventId, isCouple } = await resolveUserContext(pool, req);

    try {
      let findQuery;
      let findParams;

      if (id) {
        if (eventId && isCouple) {
          findQuery = `SELECT * FROM saved_photos WHERE id = $1 AND (user_id = $2 OR event_id = $3)`;
          findParams = [Number(id), userId, eventId];
        } else {
          findQuery = `SELECT * FROM saved_photos WHERE id = $1 AND user_id = $2`;
          findParams = [Number(id), userId];
        }
      } else if (photoUrl) {
        if (eventId && isCouple) {
          findQuery = `SELECT * FROM saved_photos WHERE photo_url = $1 AND (user_id = $2 OR event_id = $3)`;
          findParams = [photoUrl, userId, eventId];
        } else {
          findQuery = `SELECT * FROM saved_photos WHERE photo_url = $1 AND user_id = $2`;
          findParams = [photoUrl, userId];
        }
      } else {
        return reply.code(400).send({ error: 'id or photoUrl is required' });
      }

      const foundRes = await pool.query(findQuery, findParams);
      if (foundRes.rows.length > 0) {
        const itemToDelete = foundRes.rows[0];

        // Delete from database
        await pool.query(`DELETE FROM saved_photos WHERE id = $1`, [itemToDelete.id]);

        // SAFE DELETION: ONLY delete custom files in moodboard/ folder from R2.
        // Official MistyVisuals photos (FEATURED_STORY, GALLERY) are NEVER deleted!
        if (
          itemToDelete.source_type === 'MANUAL_UPLOAD' &&
          itemToDelete.photo_url &&
          itemToDelete.photo_url.includes('/moodboard/')
        ) {
          try {
            await deleteAsset(itemToDelete.photo_url);
          } catch (r2Err) {
            console.warn('[saves] Could not delete user upload from R2:', r2Err?.message);
          }
        }
      }

      return reply.send({ success: true });
    } catch (err) {
      console.error('[saves] Error deleting saved photo:', err);
      return reply.code(500).send({ error: 'Failed to delete saved photo' });
    }
  });

  // GET /api/saves - Get all saved photos for couple's event or user's private saves
  fastify.get('/api/saves', async (req, reply) => {
    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const { userId, eventId, isCouple } = await resolveUserContext(pool, req);

    try {
      if (eventId && isCouple) {
        // 1. Proactively auto-heal couple saves to link with couple's event_id
        try {
          await pool.query(
            `UPDATE saved_photos sp
             SET event_id = g.event_id,
                 display_role = g.display_role
             FROM circle_users cu
             JOIN guests g ON LOWER(g.email) = LOWER(cu.email)
             WHERE sp.user_id = cu.id
               AND g.event_id = $1
               AND g.display_role IN ('BRIDE', 'GROOM')
               AND (sp.event_id IS NULL OR sp.display_role NOT IN ('BRIDE', 'GROOM'))`,
            [eventId]
          );
        } catch (_healErr) {}

        // 2. Unlink any guest saves from the couple's event_id so they don't appear in the couple feed
        try {
          await pool.query(
            `UPDATE saved_photos sp
             SET event_id = NULL
             WHERE sp.event_id = $1
               AND sp.user_id NOT IN (
                 SELECT cu.id FROM circle_users cu
                 JOIN guests g ON LOWER(g.email) = LOWER(cu.email)
                 WHERE g.event_id = $1 AND g.display_role IN ('BRIDE', 'GROOM')
               )`,
            [eventId]
          );
        } catch (_cleanErr) {}
      }

      let query;
      let params;

      // BRIDE & GROOM: Strictly query ONLY photos saved by the Bride or Groom for this event
      if (eventId && isCouple) {
        query = `
          SELECT 
            sp.id,
            sp.event_id,
            sp.user_id,
            COALESCE(
              NULLIF(g.display_role, ''),
              NULLIF(sp.display_role, ''),
              'GUEST'
            ) as display_role,
            sp.photo_url,
            sp.story_id,
            sp.source_type,
            sp.tags,
            sp.created_at,
            COALESCE(cu.name, g.name, 'Partner') as saved_by_name,
            COALESCE(cu.email, g.email) as saved_by_email
          FROM saved_photos sp
          LEFT JOIN circle_users cu ON sp.user_id = cu.id
          LEFT JOIN guests g ON (LOWER(g.email) = LOWER(cu.email) AND g.event_id = $1)
          WHERE sp.user_id IN (
              SELECT cu2.id FROM circle_users cu2
              JOIN guests g2 ON LOWER(g2.email) = LOWER(cu2.email)
              WHERE g2.event_id = $1 AND g2.display_role IN ('BRIDE', 'GROOM')
            )
            OR (
              sp.event_id = $1 
              AND COALESCE(NULLIF(g.display_role, ''), NULLIF(sp.display_role, '')) IN ('BRIDE', 'GROOM')
            )
          ORDER BY sp.created_at DESC
        `;
        params = [eventId];
      } else {
        // REGULAR GUESTS: Query strictly their own private bookmarks
        query = `
          SELECT 
            sp.id,
            sp.event_id,
            sp.user_id,
            sp.display_role,
            sp.photo_url,
            sp.story_id,
            sp.source_type,
            sp.tags,
            sp.created_at,
            cu.name as saved_by_name,
            cu.email as saved_by_email
          FROM saved_photos sp
          LEFT JOIN circle_users cu ON sp.user_id = cu.id
          WHERE sp.user_id = $1
          ORDER BY sp.created_at DESC
        `;
        params = [userId];
      }

      const result = await pool.query(query, params);

      const items = result.rows.map(row => {
        const dRole = (row.display_role || 'GUEST').toString().toUpperCase();
        return {
          id: row.id,
          eventId: row.event_id,
          userId: row.user_id,
          photoUrl: row.photo_url,
          storyId: row.story_id,
          sourceType: row.source_type,
          tags: Array.isArray(row.tags) ? row.tags : normalizeTags(row.tags),
          createdAt: row.created_at,
          savedBy: {
            userId: row.user_id,
            name: row.saved_by_name || (dRole === 'BRIDE' ? 'Bride' : dRole === 'GROOM' ? 'Groom' : 'Partner'),
            email: row.saved_by_email,
            displayRole: dRole
          }
        };
      });

      return reply.send({ success: true, saves: items });
    } catch (err) {
      console.error('[saves] Error fetching saved photos:', err);
      return reply.code(500).send({ error: 'Failed to fetch saved photos' });
    }
  });

  // GET /api/saves/check - Check if a specific photo is saved
  fastify.get('/api/saves/check', async (req, reply) => {
    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const { photoUrl } = req.query || {};
    if (!photoUrl) {
      return reply.code(400).send({ error: 'photoUrl query parameter is required' });
    }

    const { userId, eventId, isCouple } = await resolveUserContext(pool, req);

    try {
      let result;
      if (eventId && isCouple) {
        result = await pool.query(
          `SELECT id, user_id, display_role FROM saved_photos 
           WHERE photo_url = $1 AND (user_id = $2 OR (event_id = $3 AND display_role IN ('BRIDE', 'GROOM')))` ,
          [photoUrl, userId, eventId]
        );
      } else {
        result = await pool.query(
          `SELECT id, user_id, display_role FROM saved_photos 
           WHERE photo_url = $1 AND user_id = $2`,
          [photoUrl, userId]
        );
      }

      const isSaved = result.rows.length > 0;
      return reply.send({
        isSaved,
        savedBy: isSaved ? {
          userId: result.rows[0].user_id,
          displayRole: result.rows[0].display_role
        } : null
      });
    } catch (err) {
      console.error('[saves] Error checking save status:', err);
      return reply.code(500).send({ error: 'Failed to check save status' });
    }
  });
};
