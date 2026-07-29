module.exports = function installLeadHelpers(opts) {
  const { pool, boolToYesNo } = opts;

  function normalizeLeadRow(row) {
    if (!row) return row;
    return {
      ...row,
      potential: boolToYesNo(row.potential),
      important: boolToYesNo(row.important),
    };
  }

  function normalizeLeadRows(rows = []) {
    return rows.map(normalizeLeadRow);
  }

  async function logAdminAudit(req, action, entity_type, entity_id, before_data, after_data, user_id) {
    try {
      const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null;
      const userAgent = req?.headers?.['user-agent'] || null;
      await pool.query(
        `INSERT INTO admin_audit_log (user_id, action, entity_type, entity_id, before_data, after_data, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          user_id || null,
          action,
          entity_type,
          entity_id || null,
          before_data ? JSON.stringify(before_data) : null,
          after_data ? JSON.stringify(after_data) : null,
          ip,
          userAgent,
        ]
      );
    } catch (err) {
      console.warn('Admin audit log failed:', err?.message || err);
    }
  }

  async function logLeadActivity(leadId, activityType, metadata = null, userId = null, client = pool) {
    try {
      await client.query(
        `INSERT INTO lead_activities (lead_id, activity_type, metadata, user_id)
         VALUES ($1,$2,$3,$4)`,
        [leadId, activityType, metadata, userId]
      );
    } catch (err) {
      console.warn('Activity log skipped:', err?.message || err);
    }
  }

  async function createNotification({ userId = null, roleTarget = null, title, message, category, type = 'INFO', linkUrl = null, isActionRequired = false }, client = pool) {
    try {
      await client.query(`
        INSERT INTO notifications (user_id, role_target, title, message, category, type, link_url, is_action_required)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [userId, roleTarget, title, message, category, type, linkUrl, isActionRequired]);

      client.query(`DELETE FROM notifications WHERE is_read = true AND created_at < NOW() - INTERVAL '30 days';`).catch(() => {});

      if (userId) {
        client.query(`
          DELETE FROM notifications 
          WHERE id IN (
            SELECT id FROM notifications WHERE user_id = $1 ORDER BY created_at DESC OFFSET 1000
          )
        `, [userId]).catch(() => {});
      } else if (roleTarget) {
        client.query(`
          DELETE FROM notifications 
          WHERE id IN (
            SELECT id FROM notifications WHERE role_target = $1 ORDER BY created_at DESC OFFSET 1000
          )
        `, [roleTarget]).catch(() => {});
      }
    } catch (err) {
      console.warn('Failed to create notification:', err?.message || err);
    }
  }

  async function getNextLeadNumber(client = pool) {
    const now = new Date();
    const prefix = now.getFullYear() % 100;

    await client.query('SELECT pg_advisory_xact_lock($1)', [prefix]);

    const r = await client.query(
      `
      SELECT COALESCE(
        MAX(
          CASE
            WHEN lead_number BETWEEN $1 AND $2 THEN lead_number - $3
            WHEN lead_number BETWEEN $4 AND $5 THEN lead_number - $6
            ELSE 0
          END
        ),
        0
      ) AS max_seq
      FROM leads
      WHERE lead_number IS NOT NULL
        AND lead_number BETWEEN $1 AND $5
      `,
      [
        prefix * 1000 + 1,
        prefix * 1000 + 999,
        prefix * 1000,
        prefix * 10000 + 1000,
        prefix * 10000 + 9999,
        prefix * 10000,
      ]
    );

    const nextSeq = (Number(r.rows[0]?.max_seq) || 0) + 1;
    if (nextSeq <= 999) return prefix * 1000 + nextSeq;
    return prefix * 10000 + nextSeq;
  }

  async function getOrCreateCity({ name, state, country }, client = pool) {
    const existing = await client.query(
      `SELECT id FROM cities
       WHERE name=$1 AND state=$2 AND country=$3`,
      [name, state, country]
    );

    if (existing.rows.length) return existing.rows[0].id;

    const created = await client.query(
      `INSERT INTO cities (name, state, country)
       VALUES ($1,$2,$3)
       RETURNING id`,
      [name, state, country]
    );

    return created.rows[0].id;
  }

  async function hasAnyEvent(leadId) {
    const r = await pool.query(
      `SELECT 1 FROM lead_events WHERE lead_id=$1 LIMIT 1`,
      [leadId]
    );
    return r.rows.length > 0;
  }

  async function hasAllEventTimes(leadId) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM lead_events
       WHERE lead_id=$1 AND (start_time IS NULL OR end_time IS NULL)`,
      [leadId]
    );
    return (r.rows[0]?.cnt ?? 0) === 0;
  }

  async function hasPrimaryCity(leadId) {
    const r = await pool.query(
      `SELECT 1 FROM lead_cities WHERE lead_id=$1 AND is_primary=true LIMIT 1`,
      [leadId]
    );
    return r.rows.length > 0;
  }

  async function hasEventInPrimaryCity(leadId) {
    const r = await pool.query(
      `
      SELECT 1
      FROM lead_events e
      JOIN lead_cities lc
        ON lc.city_id = e.city_id
       AND lc.lead_id = e.lead_id
       AND lc.is_primary = true
      WHERE e.lead_id = $1
      LIMIT 1
      `,
      [leadId]
    );
    return r.rows.length > 0;
  }

  async function hasEventsForAllCities(leadId) {
    const r = await pool.query(
      `
      SELECT 1
      FROM lead_cities lc
      WHERE lc.lead_id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM lead_events e
          WHERE e.lead_id = lc.lead_id
            AND e.city_id = lc.city_id
        )
      LIMIT 1
      `,
      [leadId]
    );
    return r.rows.length === 0;
  }

  async function recomputeLeadMetrics(client = pool) {
    await client.query(
      `
      WITH followups AS (
        SELECT
          lead_id,
          COUNT(*) FILTER (WHERE activity_type = 'followup_done')::int AS total_followups,
          COUNT(*) FILTER (
            WHERE activity_type = 'followup_done'
              AND metadata->>'outcome' = 'Connected'
          )::int AS connected_followups
        FROM lead_activities
        WHERE lead_id IS NOT NULL
        GROUP BY lead_id
      ),
      diffs AS (
        SELECT
          lead_id,
          AVG(EXTRACT(EPOCH FROM (created_at - prev_at)) / 86400.0) AS avg_days_between_followups
        FROM (
          SELECT
            lead_id,
            created_at,
            LAG(created_at) OVER (PARTITION BY lead_id ORDER BY created_at) AS prev_at
          FROM lead_activities
          WHERE activity_type = 'followup_done'
        ) t
        WHERE prev_at IS NOT NULL
        GROUP BY lead_id
      ),
      usage AS (
        SELECT
          lead_id,
          COALESCE(SUM(duration_seconds), 0)::int AS total_time_spent_seconds
        FROM lead_usage_logs
        GROUP BY lead_id
      ),
      last_activity AS (
        SELECT lead_id, MAX(created_at) AS last_activity_at
        FROM lead_activities
        WHERE lead_id IS NOT NULL
        GROUP BY lead_id
      ),
      last_note AS (
        SELECT lead_id, MAX(created_at) AS last_note_at
        FROM lead_notes
        GROUP BY lead_id
      )
      INSERT INTO lead_metrics (
        lead_id,
        total_followups,
        connected_followups,
        not_connected_count,
        avg_days_between_followups,
        total_time_spent_seconds,
        last_activity_at,
        days_to_first_contact,
        days_to_conversion,
        reopen_count
      )
      SELECT
        l.id,
        COALESCE(f.total_followups, 0),
        COALESCE(f.connected_followups, 0),
        COALESCE(l.not_contacted_count, 0),
        d.avg_days_between_followups,
        COALESCE(u.total_time_spent_seconds, 0),
        GREATEST(
          COALESCE(a.last_activity_at, n.last_note_at),
          COALESCE(n.last_note_at, a.last_activity_at)
        ) AS last_activity_at,
        CASE
          WHEN l.first_contacted_at IS NULL THEN NULL
          ELSE (l.first_contacted_at::date - l.created_at::date)::numeric
        END AS days_to_first_contact,
        CASE
          WHEN l.converted_at IS NULL OR l.first_contacted_at IS NULL THEN NULL
          ELSE (l.converted_at::date - l.first_contacted_at::date)::numeric
        END AS days_to_conversion,
        GREATEST(COALESCE(l.conversion_count, 0) - 1, 0) AS reopen_count
      FROM leads l
      LEFT JOIN followups f ON f.lead_id = l.id
      LEFT JOIN diffs d ON d.lead_id = l.id
      LEFT JOIN usage u ON u.lead_id = l.id
      LEFT JOIN last_activity a ON a.lead_id = l.id
      LEFT JOIN last_note n ON n.lead_id = l.id
      ON CONFLICT (lead_id) DO UPDATE SET
        total_followups = EXCLUDED.total_followups,
        connected_followups = EXCLUDED.connected_followups,
        not_connected_count = EXCLUDED.not_connected_count,
        avg_days_between_followups = EXCLUDED.avg_days_between_followups,
        total_time_spent_seconds = EXCLUDED.total_time_spent_seconds,
        last_activity_at = EXCLUDED.last_activity_at,
        days_to_first_contact = EXCLUDED.days_to_first_contact,
        days_to_conversion = EXCLUDED.days_to_conversion,
        reopen_count = EXCLUDED.reopen_count
      `
    );
  }

  async function recomputeUserMetrics(metricDate, client = pool) {
    await client.query(
      `
      WITH bounds AS (
        SELECT
          $1::date AS day_start,
          ($1::date + INTERVAL '1 day') AS day_end
      ),
      sessions AS (
        SELECT
          s.user_id,
          GREATEST(s.login_at, b.day_start) AS seg_start,
          LEAST(COALESCE(s.logout_at, s.last_seen_at, s.login_at), b.day_end) AS seg_end
        FROM user_sessions s
        CROSS JOIN bounds b
        WHERE s.login_at < b.day_end
          AND COALESCE(s.logout_at, s.last_seen_at, s.login_at) > b.day_start
      ),
      session_sums AS (
        SELECT
          user_id,
          COUNT(*)::int AS total_sessions,
          COALESCE(SUM(EXTRACT(EPOCH FROM (seg_end - seg_start))), 0)::int AS total_session_duration_seconds
        FROM sessions
        WHERE seg_end > seg_start
        GROUP BY user_id
      ),
      usage AS (
        SELECT
          user_id,
          COUNT(DISTINCT lead_id)::int AS leads_opened_count,
          COALESCE(SUM(duration_seconds), 0)::int AS total_time_spent_on_leads_seconds
        FROM lead_usage_logs
        WHERE (entered_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = $1::date
        GROUP BY user_id
      ),
      activity AS (
        SELECT
          user_id,
          SUM(CASE WHEN activity_type = 'followup_done' THEN 1 ELSE 0 END)::int AS followups_done,
          SUM(CASE WHEN activity_type = 'negotiation_entry' THEN 1 ELSE 0 END)::int AS negotiations_done,
          SUM(CASE WHEN activity_type = 'quote_generated' THEN 1 ELSE 0 END)::int AS quotes_generated,
          SUM(
            CASE
              WHEN activity_type = 'status_change' AND metadata->>'to' = 'Converted' THEN 1
              ELSE 0
            END
          )::int AS conversions
        FROM lead_activities
        WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = $1::date
          AND user_id IS NOT NULL
          AND (metadata->>'system' IS NULL OR metadata->>'system' <> 'true')
        GROUP BY user_id
      ),
      combined AS (
        SELECT
          COALESCE(s.user_id, u.user_id, a.user_id) AS user_id,
          $1::date AS metric_date,
          COALESCE(s.total_sessions, 0) AS total_sessions,
          COALESCE(s.total_session_duration_seconds, 0) AS total_session_duration_seconds,
          COALESCE(u.leads_opened_count, 0) AS leads_opened_count,
          COALESCE(u.total_time_spent_on_leads_seconds, 0) AS total_time_spent_on_leads_seconds,
          COALESCE(a.followups_done, 0) AS followups_done,
          COALESCE(a.negotiations_done, 0) AS negotiations_done,
          COALESCE(a.quotes_generated, 0) AS quotes_generated,
          COALESCE(a.conversions, 0) AS conversions
        FROM session_sums s
        FULL OUTER JOIN usage u ON u.user_id = s.user_id
        FULL OUTER JOIN activity a ON a.user_id = COALESCE(s.user_id, u.user_id)
      )
      INSERT INTO user_metrics_daily (
        user_id,
        metric_date,
        total_sessions,
        total_session_duration_seconds,
        leads_opened_count,
        total_time_spent_on_leads_seconds,
        followups_done,
        negotiations_done,
        quotes_generated,
        conversions
      )
      SELECT
        user_id,
        metric_date,
        total_sessions,
        total_session_duration_seconds,
        leads_opened_count,
        total_time_spent_on_leads_seconds,
        followups_done,
        negotiations_done,
        quotes_generated,
        conversions
      FROM combined
      WHERE user_id IS NOT NULL
      ON CONFLICT (user_id, metric_date) DO UPDATE SET
        total_sessions = EXCLUDED.total_sessions,
        total_session_duration_seconds = EXCLUDED.total_session_duration_seconds,
        leads_opened_count = EXCLUDED.leads_opened_count,
        total_time_spent_on_leads_seconds = EXCLUDED.total_time_spent_on_leads_seconds,
        followups_done = EXCLUDED.followups_done,
        negotiations_done = EXCLUDED.negotiations_done,
        quotes_generated = EXCLUDED.quotes_generated,
        conversions = EXCLUDED.conversions
      `,
      [metricDate]
    );
  }

  async function resolveUserDisplayName(name, getUserDisplayNameFn) {
    if (!name) return null;
    const trimmed = String(name).trim();
    if (!trimmed) return null;
    const r = await pool.query(
      `SELECT name, nickname
       FROM users
       WHERE (
         (name IS NOT NULL AND lower(name) = lower($1))
         OR (nickname IS NOT NULL AND lower(nickname) = lower($1))
         OR (name IS NOT NULL AND lower(split_part(name, ' ', 1)) = lower($1))
       )
         AND (role = 'admin' OR role = 'sales')
       LIMIT 1`,
      [trimmed]
    );
    if (!r.rows.length) return null;
    return getUserDisplayNameFn(r.rows[0]);
  }

  async function getRoundRobinSalesUserId(client = pool) {
    const salesRes = await client.query(
      `SELECT DISTINCT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.is_active = true 
         AND r.key = 'sales' 
         AND u.role != 'admin' 
         AND u.email != 'test@mistyvisuals.com'
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur2 
           JOIN roles r2 ON r2.id = ur2.role_id 
           WHERE ur2.user_id = u.id AND r2.key = 'admin'
         )
       ORDER BY u.id ASC`
    );
    const salesIds = salesRes.rows.map(r => r.id);
    if (!salesIds.length) return null;
    if (salesIds.length === 1) return salesIds[0];

    const lastAssigned = await client.query(
      `SELECT assigned_user_id
       FROM leads
       WHERE assigned_user_id = ANY($1::int[])
       ORDER BY created_at DESC
       LIMIT 1`,
      [salesIds]
    );
    const lastId = lastAssigned.rows[0]?.assigned_user_id || null;
    if (!lastId) return salesIds[0];
    const idx = salesIds.indexOf(lastId);
    return salesIds[(idx + 1) % salesIds.length];
  }

  return {
    normalizeLeadRow,
    normalizeLeadRows,
    logAdminAudit,
    logLeadActivity,
    createNotification,
    getNextLeadNumber,
    getOrCreateCity,
    hasAnyEvent,
    hasAllEventTimes,
    hasPrimaryCity,
    hasEventInPrimaryCity,
    hasEventsForAllCities,
    recomputeLeadMetrics,
    recomputeUserMetrics,
    resolveUserDisplayName,
    getRoundRobinSalesUserId,
  };
};
