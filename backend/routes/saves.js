const { prisma } = require('../prisma');

/**
 * Helper to resolve user context (userId, email, eventId, displayRole)
 * Automatically looks up event_id from guests table or previous saved_photos if not explicitly present in auth token
 */
async function resolveUserContext(pool, req) {
  const auth = req.auth || {};
  let userId = auth.sub || auth.id || auth.userId || null;
  let email = auth.email || req.query?.email || req.body?.email || null;
  let eventSlug = req.query?.eventSlug || req.body?.eventSlug || null;
  let eventId = req.query?.eventId || req.body?.eventId || auth.eventId || auth.event_id || null;
  let displayRole = req.query?.displayRole || req.body?.displayRole || auth.displayRole || null;

  // 1. Resolve eventId from eventSlug if passed
  if (!eventId && eventSlug) {
    try {
      const evRes = await pool.query(`SELECT id FROM gallery_events WHERE slug = $1 LIMIT 1`, [eventSlug]);
      if (evRes.rows.length > 0) {
        eventId = evRes.rows[0].id;
      }
    } catch (err) {}
  }

  // 2. If email is available, look up guest record in guests table
  if (email) {
    try {
      const guestRes = await pool.query(
        `SELECT event_id, display_role FROM guests WHERE LOWER(email) = LOWER($1) AND status != 'LEFT' ORDER BY id DESC LIMIT 1`,
        [email]
      );
      if (guestRes.rows.length > 0) {
        if (!eventId) eventId = guestRes.rows[0].event_id;
        if (!displayRole || displayRole === 'GUEST' || displayRole === 'family' || displayRole === 'guest') {
          if (guestRes.rows[0].display_role) {
            displayRole = guestRes.rows[0].display_role;
          }
        }
      }
    } catch (err) {
      console.warn('[saves] guest lookup error:', err?.message);
    }
  }

  // 3. If userId is available and eventId is still null, check previously saved photos with an event_id
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

  // 4. Auto-backfill event_id for orphaned saved_photos if eventId is resolved and user is Bride/Groom
  if (eventId && userId && isCouple) {
    try {
      await pool.query(
        `UPDATE saved_photos SET event_id = $1, display_role = $2 WHERE user_id = $3 AND event_id IS NULL`,
        [eventId, normalizedRole, userId]
      );
    } catch (err) {}
  }

  return { userId, email, eventId, displayRole: isCouple ? normalizedRole : 'GUEST', isCouple };
}

module.exports = async function savesRoutes(fastify, opts) {
  const { pool, requireAuth } = opts;

  // POST /api/saves - Save a photo
  fastify.post('/api/saves', async (req, reply) => {
    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const { photoUrl, storyId, sourceType = 'FEATURED_STORY' } = req.body || {};
    if (!photoUrl) {
      return reply.code(400).send({ error: 'photoUrl is required' });
    }

    const { userId, eventId, displayRole, isCouple } = await resolveUserContext(pool, req);

    try {
      let result;
      // Only Bride and Groom attach photos to the shared event collection
      if (eventId && isCouple) {
        result = await pool.query(
          `INSERT INTO saved_photos (event_id, user_id, display_role, photo_url, story_id, source_type)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (event_id, photo_url, user_id)
           DO UPDATE SET display_role = EXCLUDED.display_role, created_at = NOW()
           RETURNING *`,
          [eventId, userId, displayRole, photoUrl, storyId || null, sourceType]
        );
      } else {
        // Regular guests save to their own private collection
        result = await pool.query(
          `INSERT INTO saved_photos (event_id, user_id, display_role, photo_url, story_id, source_type)
           VALUES (NULL, $1, 'GUEST', $2, $3, $4)
           RETURNING *`,
          [userId, photoUrl, storyId || null, sourceType]
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

  // DELETE /api/saves - Remove a saved photo (by photoUrl or id)
  fastify.delete('/api/saves', async (req, reply) => {
    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const { photoUrl, id } = req.query || {};
    const { userId, eventId, isCouple } = await resolveUserContext(pool, req);

    try {
      if (id) {
        if (eventId && isCouple) {
          await pool.query(
            `DELETE FROM saved_photos WHERE id = $1 AND (user_id = $2 OR (event_id = $3 AND display_role IN ('BRIDE', 'GROOM')))`,
            [Number(id), userId, eventId]
          );
        } else {
          await pool.query(
            `DELETE FROM saved_photos WHERE id = $1 AND user_id = $2`,
            [Number(id), userId]
          );
        }
      } else if (photoUrl) {
        if (eventId && isCouple) {
          await pool.query(
            `DELETE FROM saved_photos WHERE photo_url = $1 AND (user_id = $2 OR (event_id = $3 AND display_role IN ('BRIDE', 'GROOM')))`,
            [photoUrl, userId, eventId]
          );
        } else {
          await pool.query(
            `DELETE FROM saved_photos WHERE photo_url = $1 AND user_id = $2`,
            [photoUrl, userId]
          );
        }
      } else {
        return reply.code(400).send({ error: 'id or photoUrl is required' });
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
      let query;
      let params;

      // BRIDE & GROOM: Return shared couple moodboard
      if (eventId && isCouple) {
        query = `
          SELECT 
            sp.id,
            sp.event_id,
            sp.user_id,
            sp.display_role,
            sp.photo_url,
            sp.story_id,
            sp.source_type,
            sp.created_at,
            cu.name as saved_by_name,
            cu.email as saved_by_email
          FROM saved_photos sp
          LEFT JOIN circle_users cu ON sp.user_id = cu.id
          WHERE (sp.event_id = $1 AND sp.display_role IN ('BRIDE', 'GROOM'))
             OR (sp.user_id = $2)
          ORDER BY sp.created_at DESC
        `;
        params = [eventId, userId];
      } else {
        // REGULAR GUESTS: Strictly return only the user's private saves
        query = `
          SELECT 
            sp.id,
            sp.event_id,
            sp.user_id,
            sp.display_role,
            sp.photo_url,
            sp.story_id,
            sp.source_type,
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

      const items = result.rows.map(row => ({
        id: row.id,
        eventId: row.event_id,
        userId: row.user_id,
        photoUrl: row.photo_url,
        storyId: row.story_id,
        sourceType: row.source_type,
        createdAt: row.created_at,
        savedBy: {
          userId: row.user_id,
          name: row.saved_by_name || 'Partner',
          email: row.saved_by_email,
          displayRole: row.display_role || 'GUEST'
        }
      }));

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
           WHERE photo_url = $1 AND (user_id = $2 OR (event_id = $3 AND display_role IN ('BRIDE', 'GROOM')))
           LIMIT 1`,
          [photoUrl, userId, eventId]
        );
      } else {
        result = await pool.query(
          `SELECT id, user_id, display_role FROM saved_photos 
           WHERE photo_url = $1 AND user_id = $2
           LIMIT 1`,
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
