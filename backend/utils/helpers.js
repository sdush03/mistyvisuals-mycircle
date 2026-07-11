module.exports = function installHelpers(opts) {
  const {
    pool,
    fs,
    path,
    crypto,
    jwt,
    fastify,
    AUTH_SECRET,
    AUTH_COOKIE,
    LEAD_STATUSES,
    COVERAGE_SCOPES,
    FOLLOWUP_TYPES,
    HEAT_VALUES,
    UPLOADS_DIR,
    PHOTO_UPLOAD_DIR
  } = opts;

const toISTDateString = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
}
  
  function boolToYesNo(value) {
    return value === true ? 'Yes' : 'No'
  }
  
  function yesNoToBool(value) {
    if (value === undefined || value === null) return null
    if (typeof value === 'boolean') return value
    const v = String(value).trim().toLowerCase()
    if (v === 'yes' || v === 'true') return true
    if (v === 'no' || v === 'false') return false
    return null
  }
  
  function ensureDirectory(dirPath) {
    try {
      fs.mkdirSync(dirPath, { recursive: true })
    } catch (err) {
      console.warn('Failed to ensure upload directory:', err?.message || err)
    }
  }
  
  function sanitizeTags(input) {
    if (!Array.isArray(input)) return []
    const clean = input
      .map(tag => String(tag || '').trim())
      .filter(Boolean)
    return Array.from(new Set(clean))
  }
  
  function getImageContentType(filename) {
    const ext = path.extname(filename || '').toLowerCase()
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
    if (ext === '.png') return 'image/png'
    if (ext === '.webp') return 'image/webp'
    if (ext === '.gif') return 'image/gif'
    return 'application/octet-stream'
  }
  
  function normalizeLeadRow(row) {
    if (!row) return row
    return {
      ...row,
      potential: boolToYesNo(row.potential),
      important: boolToYesNo(row.important),
    }
  }
  
  function normalizeLeadRows(rows = []) {
    return rows.map(normalizeLeadRow)
  }
  
  async function logAdminAudit(req, action, entity_type, entity_id, before_data, after_data, user_id) {
    try {
      const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null
      const userAgent = req?.headers?.['user-agent'] || null
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
      )
    } catch (err) {
      console.warn('Admin audit log failed:', err?.message || err)
    }
  }
  
  const PROTECTED_ADMIN_EMAIL = String(process.env.PROTECTED_ADMIN_EMAIL || 'dushyant@mistyvisuals.com')
    .trim()
    .toLowerCase()
  
  const isProtectedAdminUser = (user) => {
    const email = String(user?.email || '').trim().toLowerCase()
    const name = String(user?.name || '').trim().toLowerCase()
    return email === PROTECTED_ADMIN_EMAIL || name === 'dushyant saini'
  }
  
  function startOfDay(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }
  
  function dateToYMD(d) {
    // Always return IST date string regardless of server timezone
    return toISTDateString(d)
  }
  
  function addDaysYMD(days, base = new Date()) {
    const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
    return dateToYMD(next)
  }
  
  function normalizeYMD(value) {
    if (!value) return null
    const trimmed = String(value).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
    const parsed = new Date(`${trimmed}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) return null
    return trimmed
  }
  
  function addDaysToYMD(ymd, days) {
    const base = new Date(`${ymd}T00:00:00`)
    if (Number.isNaN(base.getTime())) return null
    base.setDate(base.getDate() + days)
    return dateToYMD(base)
  }
  
  function normalizeDateValue(value) {
    if (!value) return null
    if (value instanceof Date) {
      const year = value.getFullYear()
      const month = String(value.getMonth() + 1).padStart(2, '0')
      const day = String(value.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
    const str = String(value)
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
    const parsed = new Date(str)
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getFullYear()
      const month = String(parsed.getMonth() + 1).padStart(2, '0')
      const day = String(parsed.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
    return str.slice(0, 10)
  }
  
  function getFyLabelFromDate(date) {
    if (!date) return null
    const d = date instanceof Date ? date : new Date(date)
    if (Number.isNaN(d.getTime())) return null
    const month = d.getMonth() + 1
    const startYear = month >= 4 ? d.getFullYear() : d.getFullYear() - 1
    const endYear = startYear + 1
    return `FY${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`
  }
  
  function getCurrentFyLabel() {
    return getFyLabelFromDate(new Date())
  }
  
  function parseFyLabel(fyLabel) {
    const value = String(fyLabel || '').trim()
    const match = /^FY(\d{2})-(\d{2})$/.exec(value)
    if (!match) return null
    const startYear = 2000 + Number(match[1])
    const endYear = 2000 + Number(match[2])
    if (endYear !== startYear + 1) return null
    const startDate = `${startYear}-04-01`
    const endDate = `${endYear}-03-31`
    return { label: value, startYear, endYear, startDate, endDate }
  }
  
  function getFyRange(fyLabel) {
    const parsed = parseFyLabel(fyLabel)
    if (!parsed) return null
    return parsed
  }
  
  function listFyLabelsBetween(minDate, maxDate) {
    const labels = []
    if (!minDate || !maxDate) return labels
    const startLabel = getFyLabelFromDate(minDate)
    const endLabel = getFyLabelFromDate(maxDate)
    if (!startLabel || !endLabel) return labels
    const startParsed = parseFyLabel(startLabel)
    const endParsed = parseFyLabel(endLabel)
    if (!startParsed || !endParsed) return labels
    for (let year = endParsed.startYear; year >= startParsed.startYear; year -= 1) {
      const nextYear = year + 1
      labels.push(`FY${String(year).slice(-2)}-${String(nextYear).slice(-2)}`)
    }
    return labels
  }
  
  function formatRefDate(value) {
    if (!value) return ''
    return String(value).replace(/-/g, '').slice(0, 8)
  }
  
  async function assignReferenceCode(client, txId, baseCode) {
    if (!baseCode || !txId) return null
    try {
      await client.query(
        `UPDATE finance_transactions SET reference_code = $1 WHERE id = $2`,
        [baseCode, txId]
      )
      return baseCode
    } catch (err) {
      if (err?.code === '23505') {
        const fallback = `${baseCode}-T${txId}`
        await client.query(
          `UPDATE finance_transactions SET reference_code = $1 WHERE id = $2`,
          [fallback, txId]
        )
        return fallback
      }
      throw err
    }
  }
  
  async function getAvailableFyLabels() {
    try {
      const { rows } = await pool.query(`
        SELECT MIN(d)::date as min_date, MAX(d)::date as max_date FROM (
          SELECT MAX(created_at)::date as d FROM invoice_payments GROUP BY invoice_id
          UNION ALL
          SELECT MAX(date)::date as d FROM finance_transactions WHERE vendor_bill_id IS NOT NULL AND is_deleted = false AND is_transfer = false GROUP BY vendor_bill_id
          UNION ALL
          SELECT month::date as d FROM contribution_units
          UNION ALL
          SELECT date::date as d FROM finance_transactions WHERE transaction_type = 'overhead' AND is_deleted = false AND is_transfer = false
        ) t
      `)
      const minDate = rows[0]?.min_date
      const maxDate = rows[0]?.max_date
      const currentFy = getCurrentFyLabel()
      const labels = listFyLabelsBetween(minDate, maxDate)
      if (currentFy && !labels.includes(currentFy)) {
        labels.unshift(currentFy)
      }
      return labels.length ? labels : [currentFy].filter(Boolean)
    } catch (err) {
      const currentFy = getCurrentFyLabel()
      return currentFy ? [currentFy] : []
    }
  }
  
  async function fetchProfitProjectRows({
    fyStart,
    fyEndExclusive,
    filters = {},
  }) {
    const params = [fyStart, fyEndExclusive]
    let idx = 3
    const leadFilters = []
  
    if (filters.leadId) {
      leadFilters.push(`l.id = $${idx++}`)
      params.push(filters.leadId)
    }
    if (filters.status) {
      leadFilters.push(`l.status = $${idx++}`)
      params.push(filters.status)
    }
    if (filters.cityId) {
      leadFilters.push(`EXISTS (SELECT 1 FROM lead_cities lc WHERE lc.lead_id = l.id AND lc.city_id = $${idx++})`)
      params.push(filters.cityId)
    }
    if (filters.cityName) {
      leadFilters.push(`EXISTS (
        SELECT 1 FROM lead_cities lc
        JOIN cities c ON c.id = lc.city_id
        WHERE lc.lead_id = l.id AND lower(c.name) = lower($${idx++})
      )`)
      params.push(filters.cityName)
    }
  
    if (filters.eventType || filters.eventFrom || filters.eventTo) {
      const eventClauses = []
      if (filters.eventType) {
        eventClauses.push(`e.event_type = $${idx++}`)
        params.push(filters.eventType)
      }
      if (filters.eventFrom) {
        eventClauses.push(`e.event_date >= $${idx++}`)
        params.push(filters.eventFrom)
      }
      if (filters.eventTo) {
        eventClauses.push(`e.event_date <= $${idx++}`)
        params.push(filters.eventTo)
      }
      leadFilters.push(`EXISTS (
        SELECT 1 FROM lead_events e
        WHERE e.lead_id = l.id ${eventClauses.length ? `AND ${eventClauses.join(' AND ')}` : ''}
      )`)
    }
  
    const leadWhere = leadFilters.length ? `WHERE ${leadFilters.join(' AND ')}` : ''
  
    const { rows } = await pool.query(
      `
      WITH paid_invoices AS (
        SELECT i.id, i.lead_id, i.total_amount, MAX(p.created_at)::date as paid_date
        FROM invoices i
        JOIN invoice_payments p ON p.invoice_id = i.id
        WHERE i.status = 'paid'
        GROUP BY i.id
      ),
      revenue AS (
        SELECT lead_id, SUM(total_amount) as total_revenue
        FROM paid_invoices
        WHERE paid_date >= $1 AND paid_date < $2
        GROUP BY lead_id
      ),
      paid_vendor AS (
        SELECT vb.id, vb.lead_id, vb.bill_amount, vb.is_billable_to_client, MAX(ft.date)::date as paid_date
        FROM vendor_bills vb
        JOIN finance_transactions ft ON ft.vendor_bill_id = vb.id AND ft.is_deleted = false AND ft.is_transfer = false
        WHERE vb.status = 'paid'
        GROUP BY vb.id
      ),
      vendor_cost AS (
        SELECT lead_id, SUM(bill_amount) as total_vendor
        FROM paid_vendor pv
        WHERE pv.paid_date >= $1 AND pv.paid_date < $2
          AND NOT (
            pv.is_billable_to_client = true
            AND EXISTS (
              SELECT 1 FROM invoice_line_items ili
              WHERE ili.vendor_bill_id = pv.id
            )
          )
        GROUP BY lead_id
      ),
      cu AS (
        SELECT cu.user_id,
               cu.lead_id,
               date_trunc('month', cu.month)::date as month_start,
               COUNT(*) as cu_count
        FROM contribution_units cu
        WHERE cu.month >= $1 AND cu.month < $2
        GROUP BY cu.user_id, cu.lead_id, month_start
      ),
      cu_totals AS (
        SELECT user_id, month_start, SUM(cu_count) as total_cu
        FROM cu
        GROUP BY user_id, month_start
      ),
      salaries AS (
        SELECT ecp.user_id, ecp.base_amount
        FROM employee_compensation_profiles ecp
        WHERE ecp.is_active = true
          AND ecp.base_amount IS NOT NULL
          AND ecp.employment_type IN ('salaried','stipend','salaried_plus_variable')
      ),
      payroll_alloc AS (
        SELECT cu.lead_id,
               (cu.cu_count / NULLIF(ct.total_cu, 0)) * s.base_amount as allocated
        FROM cu
        JOIN cu_totals ct ON ct.user_id = cu.user_id AND ct.month_start = cu.month_start
        JOIN salaries s ON s.user_id = cu.user_id
      ),
      payroll_overhead AS (
        SELECT lead_id, SUM(allocated) as total_payroll
        FROM payroll_alloc
        GROUP BY lead_id
      ),
      infra AS (
        SELECT date_trunc('month', ft.date)::date as month_start,
               SUM(ft.amount) as total_infra
        FROM finance_transactions ft
        WHERE ft.transaction_type = 'overhead'
          AND ft.is_deleted = false
          AND ft.is_transfer = false
          AND ft.date >= $1 AND ft.date < $2
        GROUP BY month_start
      ),
      active_events AS (
        SELECT cu.lead_id, date_trunc('month', cu.month)::date as month_start
        FROM contribution_units cu
        WHERE cu.month >= $1 AND cu.month < $2
        UNION
        SELECT vb.lead_id, date_trunc('month', ft.date)::date as month_start
        FROM finance_transactions ft
        JOIN vendor_bills vb ON vb.id = ft.vendor_bill_id
        WHERE ft.vendor_bill_id IS NOT NULL AND ft.is_deleted = false AND ft.is_transfer = false
          AND ft.date >= $1 AND ft.date < $2 AND vb.lead_id IS NOT NULL
        UNION
        SELECT la.lead_id, date_trunc('month', la.created_at)::date as month_start
        FROM lead_activities la
        WHERE la.created_at >= $1 AND la.created_at < $2 AND la.lead_id IS NOT NULL
        UNION
        SELECT lul.lead_id, date_trunc('month', lul.entered_at)::date as month_start
        FROM lead_usage_logs lul
        WHERE lul.entered_at >= $1 AND lul.entered_at < $2 AND lul.lead_id IS NOT NULL
      ),
      active_counts AS (
        SELECT month_start, COUNT(DISTINCT lead_id) as active_projects
        FROM active_events
        GROUP BY month_start
      ),
      active_leads AS (
        SELECT DISTINCT lead_id, month_start FROM active_events
      ),
      infra_alloc AS (
        SELECT al.lead_id,
               SUM(infra.total_infra / NULLIF(ac.active_projects, 0)) as total_infra
        FROM active_leads al
        JOIN infra ON infra.month_start = al.month_start
        JOIN active_counts ac ON ac.month_start = al.month_start
        GROUP BY al.lead_id
      ),
      lead_base AS (
        SELECT lead_id FROM revenue
        UNION
        SELECT lead_id FROM vendor_cost
        UNION
        SELECT lead_id FROM payroll_overhead
        UNION
        SELECT lead_id FROM infra_alloc
        UNION
        SELECT DISTINCT lead_id FROM active_events
      )
      SELECT
        l.id as lead_id,
        l.lead_number,
        l.name,
        l.bride_name,
        l.groom_name,
        l.status,
        COALESCE(r.total_revenue, 0) as revenue,
        COALESCE(v.total_vendor, 0) as vendor_cost,
        COALESCE(p.total_payroll, 0) as payroll_overhead,
        COALESCE(i.total_infra, 0) as infra_overhead
      FROM lead_base lb
      JOIN leads l ON l.id = lb.lead_id
      LEFT JOIN revenue r ON r.lead_id = lb.lead_id
      LEFT JOIN vendor_cost v ON v.lead_id = lb.lead_id
      LEFT JOIN payroll_overhead p ON p.lead_id = lb.lead_id
      LEFT JOIN infra_alloc i ON i.lead_id = lb.lead_id
      ${leadWhere}
      `,
      params
    )
  
    return rows
  }
  
  async function logLeadActivity(leadId, activityType, metadata = null, userId = null, client = pool) {
    try {
      await client.query(
        `INSERT INTO lead_activities (lead_id, activity_type, metadata, user_id)
         VALUES ($1,$2,$3,$4)`,
        [leadId, activityType, metadata, userId]
      )
    } catch (err) {
      console.warn('Activity log skipped:', err?.message || err)
    }
  }
  
  async function createNotification({ userId = null, roleTarget = null, title, message, category, type = 'INFO', linkUrl = null, isActionRequired = false }, client = pool) {
    try {
      await client.query(`
        INSERT INTO notifications (user_id, role_target, title, message, category, type, link_url, is_action_required)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [userId, roleTarget, title, message, category, type, linkUrl, isActionRequired])
  
      // Cleanup: Fire and forget (don't await)
      // 1. Delete read notifications older than 30 days
      client.query(`DELETE FROM notifications WHERE is_read = true AND created_at < NOW() - INTERVAL '30 days';`).catch(() => {})
  
      // 2. Keep only latest 1000 per target (user or role)
      if (userId) {
        client.query(`
          DELETE FROM notifications 
          WHERE id IN (
            SELECT id FROM notifications WHERE user_id = $1 ORDER BY created_at DESC OFFSET 1000
          )
        `, [userId]).catch(() => {})
      } else if (roleTarget) {
        client.query(`
          DELETE FROM notifications 
          WHERE id IN (
            SELECT id FROM notifications WHERE role_target = $1 ORDER BY created_at DESC OFFSET 1000
          )
        `, [roleTarget]).catch(() => {})
      }
    } catch (err) {
      console.warn('Failed to create notification:', err?.message || err)
    }
  }
  
  async function getNextLeadNumber(client = pool) {
    const now = new Date()
    const prefix = now.getFullYear() % 100
  
    // lock per-year to avoid collisions
    await client.query('SELECT pg_advisory_xact_lock($1)', [prefix])
  
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
    )
  
    const nextSeq = (Number(r.rows[0]?.max_seq) || 0) + 1
    if (nextSeq <= 999) return prefix * 1000 + nextSeq
    return prefix * 10000 + nextSeq
  }
  
  async function getOrCreateCity({ name, state, country }, client = pool) {
    const existing = await client.query(
      `SELECT id FROM cities
       WHERE name=$1 AND state=$2 AND country=$3`,
      [name, state, country]
    )
  
    if (existing.rows.length) return existing.rows[0].id
  
    const created = await client.query(
      `INSERT INTO cities (name, state, country)
       VALUES ($1,$2,$3)
       RETURNING id`,
      [name, state, country]
    )
  
    return created.rows[0].id
  }
  
  async function hasAnyEvent(leadId) {
    const r = await pool.query(
      `SELECT 1 FROM lead_events WHERE lead_id=$1 LIMIT 1`,
      [leadId]
    )
    return r.rows.length > 0
  }
  
  async function hasAllEventTimes(leadId) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM lead_events
       WHERE lead_id=$1 AND (start_time IS NULL OR end_time IS NULL)`,
      [leadId]
    )
    return (r.rows[0]?.cnt ?? 0) === 0
  }
  
  async function hasPrimaryCity(leadId) {
    const r = await pool.query(
      `SELECT 1 FROM lead_cities WHERE lead_id=$1 AND is_primary=true LIMIT 1`,
      [leadId]
    )
    return r.rows.length > 0
  }
  
  function normalizeNickname(value) {
    if (value === undefined || value === null) return null
    const trimmed = String(value).trim()
    if (!trimmed) return null
    const capped =
      trimmed.length > 50 ? trimmed.slice(0, 50) : trimmed
    return `${capped.charAt(0).toUpperCase()}${capped.slice(1)}`
  }
  
  function getFirstName(value) {
    if (!value) return null
    const trimmed = String(value).trim()
    if (!trimmed) return null
    return trimmed.split(/\s+/)[0] || null
  }
  
  function getUserDisplayName(user) {
    if (!user) return null
    const nickname = normalizeNickname(user.nickname)
    if (nickname) return nickname
    const firstName = getFirstName(user.first_name || user.name)
    if (firstName) return firstName
    if (user.name && String(user.name).trim()) return String(user.name).trim()
    return null
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
    )
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
    )
  }
  
  async function resolveUserDisplayName(name) {
    if (!name) return null
    const trimmed = String(name).trim()
    if (!trimmed) return null
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
    )
    if (!r.rows.length) return null
    return getUserDisplayName(r.rows[0])
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
    )
    const salesIds = salesRes.rows.map(r => r.id)
    if (!salesIds.length) return null
    if (salesIds.length === 1) return salesIds[0]
  
    const lastAssigned = await client.query(
      `SELECT assigned_user_id
       FROM leads
       WHERE assigned_user_id = ANY($1::int[])
       ORDER BY created_at DESC
       LIMIT 1`,
      [salesIds]
    )
    const lastId = lastAssigned.rows[0]?.assigned_user_id || null
    if (!lastId) return salesIds[0]
    const idx = salesIds.indexOf(lastId)
    return salesIds[(idx + 1) % salesIds.length]
  }
  function getDateRange(query) {
    const to = query.to ? new Date(query.to) : new Date()
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    return { from, to }
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
    )
  
    return r.rows.length > 0
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
    )
  
    return r.rows.length === 0
  }
  
  function normalizePhone(raw) {
    if (!raw) return null
  
    let p = raw.trim()
  
    // already has country code
    if (p.startsWith('+')) return p
  
    // numeric only → assume India
    return `+91${p}`
  }
  
  function canonicalizePhone(raw) {
    if (!raw) return null
    const trimmed = String(raw).trim()
    if (!trimmed) return null
    const hasPlus = trimmed.startsWith('+')
    const digits = trimmed.replace(/\D/g, '')
    if (!digits) return null
    const value = hasPlus ? `+${digits}` : digits
    return normalizePhone(value)
  }
  
  function formatName(value) {
    if (!value) return null
    const trimmed = String(value).trim()
    if (!trimmed) return null
    return trimmed
      .split(/\s+/)
      .map(part =>
        part
          ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
          : ''
      )
      .join(' ')
  }
  
  const EMAIL_TYPO_MAP = {
    'gmial.com': 'gmail.com',
    'gmal.com': 'gmail.com',
    'gmail.con': 'gmail.com',
    'hotmial.com': 'hotmail.com',
    'yaho.com': 'yahoo.com',
    'outlook.con': 'outlook.com',
  }
  
  const ALLOWED_EMAIL_TLDS = new Set([
    'com',
    'in',
    'co',
    'org',
    'net',
    'edu',
    'gov',
  ])
  
  const ALLOWED_COMPOUND_TLDS = new Set([
    'co.in',
    'org.in',
  ])
  
  const COMMON_EMAIL_DOMAINS = new Set([
    'gmail.com',
    'hotmail.com',
    'yahoo.com',
    'outlook.com',
    'icloud.com',
    'live.com',
    'msn.com',
    'protonmail.com',
    'zoho.com',
    'ymail.com',
    'rediffmail.com',
  ])
  
  function normalizeEmailInput(value) {
    if (!value) return ''
    let email = String(value).trim().toLowerCase()
    if (!email) return ''
    email = email.replace(/^https?:\/\//i, '')
    email = email.replace(/^mailto:/i, '')
    email = email.replace(/\s+/g, '')
  
    const parts = email.split('@')
    if (parts.length === 2) {
      let [local, domain] = parts
      if (EMAIL_TYPO_MAP[domain]) {
        domain = EMAIL_TYPO_MAP[domain]
      }
      email = `${local}@${domain}`
    }
    return email
  }
  
  function validateEmail(value) {
    if (!value) return { valid: true, normalized: '' }
    const normalized = normalizeEmailInput(value)
    if (!normalized) return { valid: true, normalized: '' }
  
    const parts = normalized.split('@')
    if (parts.length !== 2) return { valid: false, normalized }
    const [local, domain] = parts
    if (!local || !domain) return { valid: false, normalized }
  
    if (!/^[a-z0-9._%+-]+$/.test(local)) return { valid: false, normalized }
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return { valid: false, normalized }
  
    if (!/^[a-z0-9.-]+$/.test(domain)) return { valid: false, normalized }
    if (!domain.includes('.')) return { valid: false, normalized }
    if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return { valid: false, normalized }
  
    const labels = domain.split('.')
    if (labels.some(l => !l || l.length > 63)) return { valid: false, normalized }
    if (labels.some(l => l.startsWith('-') || l.endsWith('-'))) return { valid: false, normalized }
  
    const lowerDomain = domain.toLowerCase()
    let sld = ''
    if (ALLOWED_COMPOUND_TLDS.has(labels.slice(-2).join('.'))) {
      sld = labels[labels.length - 3] || ''
    } else {
      const tld = labels[labels.length - 1]
      if (!ALLOWED_EMAIL_TLDS.has(tld)) return { valid: false, normalized }
      sld = labels[labels.length - 2] || ''
    }
  
    if (!sld) return { valid: false, normalized }
    if (sld.length >= 5 && !/[aeiouy]/i.test(sld) && !COMMON_EMAIL_DOMAINS.has(lowerDomain)) {
      return { valid: false, normalized }
    }
  
    return { valid: true, normalized }
  }
  
  function isValidInstagramUsername(value) {
    if (!value) return false
    const username = String(value).trim()
    if (!username) return false
    if (/^https?:/i.test(username)) return false
    if (/instagram\.com/i.test(username)) return false
    if (username.includes('/') || username.includes('@')) return false
    const normalized = username.toLowerCase()
    if (!/^[a-z0-9._]{1,30}$/.test(normalized)) return false
    return true
  }
  
  function normalizeInstagramUrl(value) {
    if (!value) return null
    const username = String(value).trim().toLowerCase()
    if (!isValidInstagramUsername(username)) return null
    return `https://instagram.com/${username}`
  }
  
  function canonicalizeEmail(value) {
    if (!value) return null
    const normalized = normalizeEmailInput(value)
    if (!normalized) return null
    return normalized
  }
  
  function canonicalizeInstagram(value) {
    if (!value) return null
    let raw = String(value).trim()
    if (!raw) return null
    raw = raw.replace(/^https?:\/\//i, '')
    raw = raw.replace(/^www\./i, '')
    if (raw.toLowerCase().includes('instagram.com')) {
      raw = raw.split('instagram.com/')[1] || ''
    }
    raw = raw.replace(/^@/, '')
    raw = raw.split(/[/?#]/)[0] || ''
    if (!isValidInstagramUsername(raw)) return null
    return `https://instagram.com/${raw.toLowerCase()}`
  }
  
  function parseCookies(header) {
    const out = {}
    if (!header) return out
    const parts = header.split(';')
    for (const part of parts) {
      const [key, ...rest] = part.trim().split('=')
      out[key] = decodeURIComponent(rest.join('=') || '')
    }
    return out
  }
  
  function signToken(payload) {
    return fastify.jwt.sign(payload)
  }
  
  function verifyToken(token) {
    try {
      return fastify.jwt.verify(token)
    } catch {
      return null
    }
  }
  
  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex')
    const iterations = 100000
    const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex')
    return `pbkdf2$${iterations}$${salt}$${hash}`
  }
  
  function verifyPassword(password, stored) {
    try {
      const [algo, iterStr, salt, hash] = stored.split('$')
      if (algo !== 'pbkdf2') return false
      const iterations = parseInt(iterStr, 10)
      const test = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex')
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'))
    } catch {
      return false
    }
  }
  
  function parseDataUrl(dataUrl) {
    const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl || '')
    if (!match) return null
    const mime = match[1].toLowerCase().replace('jpg', 'jpeg')
    const base64 = match[2]
    return { mime, base64 }
  }
  
  function setAuthCookie(reply, token) {
    reply.setCookie(AUTH_COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    })
  }
  
  function clearAuthCookie(reply) {
    const common = {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      expires: new Date(0),
    }
    
    // Clear without domain (covers current host)
    reply.setCookie(AUTH_COOKIE, '', common)
  
    // Also try clearing common domain patterns to hit any legacy stuck cookies
    if (process.env.NODE_ENV === 'production') {
      reply.setCookie(AUTH_COOKIE, '', { ...common, domain: '.mistyvisuals.com' })
      reply.setCookie(AUTH_COOKIE, '', { ...common, domain: 'mistyvisuals.com' })
      reply.setCookie(AUTH_COOKIE, '', { ...common, domain: '.mistyvisuals.in' })
      reply.setCookie(AUTH_COOKIE, '', { ...common, domain: 'mistyvisuals.in' })
    }
  }
  
  function getAuthFromRequest(req) {
    let token =
      (req.cookies && req.cookies[AUTH_COOKIE]) ||
      parseCookies(req.headers.cookie || '')[AUTH_COOKIE]
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ')
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        token = parts[1]
      }
    }
    if (!token) return null
    return verifyToken(token)
  }
  
  function requireAuth(req, reply) {
    const auth = getAuthFromRequest(req)
    if (!auth) {
      reply.code(401).send({ error: 'Not authenticated' })
      return null
    }
    return auth
  }
  
  function requireAdmin(req, reply) {
    const auth = requireAuth(req, reply)
    if (!auth) return null
    const roles = Array.isArray(auth.roles) ? auth.roles : auth.role ? [auth.role] : []
    if (!roles.includes('admin')) {
      reply.code(403).send({ error: 'Admin only' })
      return null
    }
    return auth
  }
  
  async function requireVendor(req, reply) {
    const auth = requireAuth(req, reply)
    if (!auth) return null
    const roles = Array.isArray(auth.roles) ? auth.roles : auth.role ? [auth.role] : []
    if (roles.includes('admin')) {
      reply.code(403).send({ error: 'Vendor portal is not available for admin users' })
      return null
    }
    const userId = auth.sub
    if (!userId) {
      reply.code(401).send({ error: 'Not authenticated' })
      return null
    }
    try {
      const { rows } = await pool.query(`SELECT * FROM vendors WHERE user_id = $1 AND is_active = true`, [userId])
      if (!rows.length) {
        reply.code(403).send({ error: 'Vendor profile not linked. Contact admin.' })
        return null
      }
      return { user: { id: userId, email: auth.email, role: auth.role }, roles, vendor: rows[0] }
    } catch (err) {
      reply.code(500).send({ error: 'Server error' })
      return null
    }
  }

  return {
    setAuthCookie,
    normalizeYMD,
    getUserDisplayName,
    canonicalizeInstagram,
    startOfDay,
    ALLOWED_COMPOUND_TLDS,
    listFyLabelsBetween,
    recomputeLeadMetrics,
    normalizeEmailInput,
    addDaysToYMD,
    recomputeUserMetrics,
    resolveUserDisplayName,
    COMMON_EMAIL_DOMAINS,
    hasEventsForAllCities,
    signToken,
    EMAIL_TYPO_MAP,
    logAdminAudit,
    hasAnyEvent,
    sanitizeTags,
    getCurrentFyLabel,
    getOrCreateCity,
    requireAuth,
    parseDataUrl,
    normalizeLeadRow,
    ensureDirectory,
    ALLOWED_EMAIL_TLDS,
    hasAllEventTimes,
    canonicalizeEmail,
    normalizeInstagramUrl,
    normalizeLeadRows,
    isProtectedAdminUser,
    parseCookies,
    getFirstName,
    getAuthFromRequest,
    normalizePhone,
    hasEventInPrimaryCity,
    isValidInstagramUsername,
    createNotification,
    formatName,
    normalizeNickname,
    getDateRange,
    requireVendor,
    dateToYMD,
    validateEmail,
    assignReferenceCode,
    formatRefDate,
    PROTECTED_ADMIN_EMAIL,
    getAvailableFyLabels,
    yesNoToBool,
    verifyPassword,
    getFyLabelFromDate,
    logLeadActivity,
    getFyRange,
    boolToYesNo,
    getImageContentType,
    getRoundRobinSalesUserId,
    parseFyLabel,
    hashPassword,
    hasPrimaryCity,
    verifyToken,
    requireAdmin,
    normalizeDateValue,
    addDaysYMD,
    clearAuthCookie,
    fetchProfitProjectRows,
    toISTDateString,
    getNextLeadNumber,
    canonicalizePhone
  }
}
