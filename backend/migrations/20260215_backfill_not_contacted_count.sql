WITH last_connected AS (
  SELECT lead_id, MAX(created_at) AS last_connected
  FROM lead_activities
  WHERE activity_type = 'followup_done'
    AND metadata->>'outcome' = 'Connected'
  GROUP BY lead_id
),
counts AS (
  SELECT a.lead_id, COUNT(*)::int AS cnt
  FROM lead_activities a
  LEFT JOIN last_connected lc ON lc.lead_id = a.lead_id
  WHERE a.activity_type = 'followup_done'
    AND a.metadata->>'outcome' = 'Not connected'
    AND a.created_at > COALESCE(lc.last_connected, 'epoch'::timestamp)
  GROUP BY a.lead_id
)
UPDATE leads l
SET not_contacted_count = COALESCE(c.cnt, 0)
FROM counts c
WHERE l.id = c.lead_id;

UPDATE leads
SET not_contacted_count = 0
WHERE not_contacted_count IS NULL;
