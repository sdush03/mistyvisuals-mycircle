-- Backfill first_contacted_at and converted_at using historical activity logs
-- Only fills when currently NULL

WITH first_contact AS (
  SELECT lead_id, MIN(created_at) AS first_contacted_at
  FROM lead_activities
  WHERE activity_type = 'status_change'
    AND metadata->>'to' = 'Contacted'
  GROUP BY lead_id
)
UPDATE leads l
SET first_contacted_at = fc.first_contacted_at
FROM first_contact fc
WHERE l.id = fc.lead_id
  AND l.first_contacted_at IS NULL;

WITH first_conv AS (
  SELECT lead_id, MIN(created_at) AS converted_at
  FROM lead_activities
  WHERE activity_type = 'status_change'
    AND metadata->>'to' = 'Converted'
  GROUP BY lead_id
)
UPDATE leads l
SET converted_at = fc.converted_at
FROM first_conv fc
WHERE l.id = fc.lead_id
  AND l.converted_at IS NULL;

WITH conv_counts AS (
  SELECT lead_id, COUNT(*)::int AS cnt
  FROM lead_activities
  WHERE activity_type = 'status_change'
    AND metadata->>'to' = 'Converted'
  GROUP BY lead_id
)
UPDATE leads l
SET conversion_count = cc.cnt
FROM conv_counts cc
WHERE l.id = cc.lead_id
  AND (l.conversion_count IS NULL OR l.conversion_count = 0);
