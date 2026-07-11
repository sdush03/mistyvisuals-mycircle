-- Dedup table: one row per notification key per calendar day
-- Prevents the same smart notification from firing twice in one day.
CREATE TABLE IF NOT EXISTS smart_notification_log (
  notif_key  TEXT NOT NULL,
  sent_date  DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notif_key, sent_date)
);

CREATE INDEX IF NOT EXISTS idx_smart_notif_log_date ON smart_notification_log(sent_date);

-- Auto-clean entries older than 30 days (optional, run via a periodic job)
-- DELETE FROM smart_notification_log WHERE sent_date < CURRENT_DATE - INTERVAL '30 days';
