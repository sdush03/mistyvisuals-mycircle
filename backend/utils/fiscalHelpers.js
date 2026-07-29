module.exports = function installFiscalHelpers(opts) {
  const { pool } = opts;

  function getFyLabelFromDate(date) {
    if (!date) return null;
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    const month = d.getMonth() + 1;
    const startYear = month >= 4 ? d.getFullYear() : d.getFullYear() - 1;
    const endYear = startYear + 1;
    return `FY${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
  }

  function getCurrentFyLabel() {
    return getFyLabelFromDate(new Date());
  }

  function parseFyLabel(fyLabel) {
    const value = String(fyLabel || '').trim();
    const match = /^FY(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const startYear = 2000 + Number(match[1]);
    const endYear = 2000 + Number(match[2]);
    if (endYear !== startYear + 1) return null;
    const startDate = `${startYear}-04-01`;
    const endDate = `${endYear}-03-31`;
    return { label: value, startYear, endYear, startDate, endDate };
  }

  function getFyRange(fyLabel) {
    const parsed = parseFyLabel(fyLabel);
    if (!parsed) return null;
    return parsed;
  }

  function listFyLabelsBetween(minDate, maxDate) {
    const labels = [];
    if (!minDate || !maxDate) return labels;
    const startLabel = getFyLabelFromDate(minDate);
    const endLabel = getFyLabelFromDate(maxDate);
    if (!startLabel || !endLabel) return labels;
    const startParsed = parseFyLabel(startLabel);
    const endParsed = parseFyLabel(endLabel);
    if (!startParsed || !endParsed) return labels;
    for (let year = endParsed.startYear; year >= startParsed.startYear; year -= 1) {
      const nextYear = year + 1;
      labels.push(`FY${String(year).slice(-2)}-${String(nextYear).slice(-2)}`);
    }
    return labels;
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
      `);
      const minDate = rows[0]?.min_date;
      const maxDate = rows[0]?.max_date;
      const currentFy = getCurrentFyLabel();
      const labels = listFyLabelsBetween(minDate, maxDate);
      if (currentFy && !labels.includes(currentFy)) {
        labels.unshift(currentFy);
      }
      return labels.length ? labels : [currentFy].filter(Boolean);
    } catch (err) {
      const currentFy = getCurrentFyLabel();
      return currentFy ? [currentFy] : [];
    }
  }

  async function assignReferenceCode(client, txId, baseCode) {
    if (!baseCode || !txId) return null;
    try {
      await client.query(
        `UPDATE finance_transactions SET reference_code = $1 WHERE id = $2`,
        [baseCode, txId]
      );
      return baseCode;
    } catch (err) {
      if (err?.code === '23505') {
        const fallback = `${baseCode}-T${txId}`;
        await client.query(
          `UPDATE finance_transactions SET reference_code = $1 WHERE id = $2`,
          [fallback, txId]
        );
        return fallback;
      }
      throw err;
    }
  }

  async function fetchProfitProjectRows({
    fyStart,
    fyEndExclusive,
    filters = {},
  }) {
    const params = [fyStart, fyEndExclusive];
    let idx = 3;
    const leadFilters = [];

    if (filters.leadId) {
      leadFilters.push(`l.id = $${idx++}`);
      params.push(filters.leadId);
    }
    if (filters.status) {
      leadFilters.push(`l.status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.cityId) {
      leadFilters.push(`EXISTS (SELECT 1 FROM lead_cities lc WHERE lc.lead_id = l.id AND lc.city_id = $${idx++})`);
      params.push(filters.cityId);
    }
    if (filters.cityName) {
      leadFilters.push(`EXISTS (
        SELECT 1 FROM lead_cities lc
        JOIN cities c ON c.id = lc.city_id
        WHERE lc.lead_id = l.id AND lower(c.name) = lower($${idx++})
      )`);
      params.push(filters.cityName);
    }

    if (filters.eventType || filters.eventFrom || filters.eventTo) {
      const eventClauses = [];
      if (filters.eventType) {
        eventClauses.push(`e.event_type = $${idx++}`);
        params.push(filters.eventType);
      }
      if (filters.eventFrom) {
        eventClauses.push(`e.event_date >= $${idx++}`);
        params.push(filters.eventFrom);
      }
      if (filters.eventTo) {
        eventClauses.push(`e.event_date <= $${idx++}`);
        params.push(filters.eventTo);
      }
      leadFilters.push(`EXISTS (
        SELECT 1 FROM lead_events e
        WHERE e.lead_id = l.id ${eventClauses.length ? `AND ${eventClauses.join(' AND ')}` : ''}
      )`);
    }

    const leadWhere = leadFilters.length ? `WHERE ${leadFilters.join(' AND ')}` : '';

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
    );

    return rows;
  }

  return {
    getFyLabelFromDate,
    getCurrentFyLabel,
    parseFyLabel,
    getFyRange,
    listFyLabelsBetween,
    getAvailableFyLabels,
    assignReferenceCode,
    fetchProfitProjectRows,
  };
};
