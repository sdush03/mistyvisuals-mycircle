const { prisma } = require('../prisma');

module.exports = async function savesRoutes(fastify, opts) {
  const { pool, requireAuth } = opts;

  // POST /api/saves - Save a photo
  fastify.post('/api/saves', async (req, reply) => {
    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const { photoUrl, storyId, sourceType = 'FEATURED_STORY', displayRole } = req.body || {};
    if (!photoUrl) {
      return reply.code(400).send({ error: 'photoUrl is required' });
    }

    const userId = auth.sub || auth.id || auth.userId;
    const eventId = auth.eventId || auth.event_id || null;
    let roleToStore = displayRole || auth.displayRole || auth.role || null;

    if (!roleToStore && eventId && auth.email) {
      try {
        const guestRes = await pool.query(
          `SELECT display_role FROM guests WHERE event_id = $1 AND LOWER(email) = LOWER($2)`,
          [eventId, auth.email]
        );
        if (guestRes.rows.length && guestRes.rows[0].display_role) {
          roleToStore = guestRes.rows[0].display_role;
        }
      } catch (err) {
        console.warn('[saves] Could not lookup guest display_role:', err?.message);
      }
    }
    if (!roleToStore) roleToStore = 'GUEST';

    try {
      // Upsert/Insert into saved_photos using pool
      const result = await pool.query(
        `INSERT INTO saved_photos (event_id, user_id, display_role, photo_url, story_id, source_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (event_id, photo_url, user_id)
         DO UPDATE SET display_role = EXCLUDED.display_role, created_at = NOW()
         RETURNING *`,
        [eventId, userId, roleToStore, photoUrl, storyId || null, sourceType]
      );

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
    const userId = auth.sub || auth.id || auth.userId;
    const eventId = auth.eventId || auth.event_id || null;

    try {
      if (id) {
        await pool.query(
          `DELETE FROM saved_photos WHERE id = $1 AND (user_id = $2 OR event_id = $3)`,
          [Number(id), userId, eventId]
        );
      } else if (photoUrl) {
        await pool.query(
          `DELETE FROM saved_photos WHERE photo_url = $1 AND (user_id = $2 OR event_id = $3)`,
          [photoUrl, userId, eventId]
        );
      } else {
        return reply.code(400).send({ error: 'id or photoUrl is required' });
      }

      return reply.send({ success: true });
    } catch (err) {
      console.error('[saves] Error deleting saved photo:', err);
      return reply.code(500).send({ error: 'Failed to delete saved photo' });
    }
  });

  // GET /api/saves - Get all saved photos for couple's event
  fastify.get('/api/saves', async (req, reply) => {
    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const userId = auth.sub || auth.id || auth.userId;
    const eventId = auth.eventId || auth.event_id || null;

    try {
      // Query saved photos for this event or user, joining circle_users for profile info
      let query;
      let params;

      if (eventId) {
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
          WHERE sp.event_id = $1
          ORDER BY sp.created_at DESC
        `;
        params = [eventId];
      } else {
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

    const userId = auth.sub || auth.id || auth.userId;
    const eventId = auth.eventId || auth.event_id || null;

    try {
      const result = await pool.query(
        `SELECT id, user_id, display_role FROM saved_photos 
         WHERE photo_url = $1 AND (user_id = $2 OR event_id = $3)
         LIMIT 1`,
        [photoUrl, userId, eventId]
      );

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
