CREATE TABLE IF NOT EXISTS lead_metrics (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  total_followups INTEGER NOT NULL DEFAULT 0,
  connected_followups INTEGER NOT NULL DEFAULT 0,
  not_connected_count INTEGER NOT NULL DEFAULT 0,
  avg_days_between_followups NUMERIC NULL,
  total_time_spent_seconds INTEGER NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMP NULL,
  days_to_first_contact NUMERIC NULL,
  days_to_conversion NUMERIC NULL,
  reopen_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_metrics_daily (
  user_id INTEGER NOT NULL REFERENCES users(id),
  metric_date DATE NOT NULL,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  total_session_duration_seconds INTEGER NOT NULL DEFAULT 0,
  leads_opened_count INTEGER NOT NULL DEFAULT 0,
  total_time_spent_on_leads_seconds INTEGER NOT NULL DEFAULT 0,
  followups_done INTEGER NOT NULL DEFAULT 0,
  negotiations_done INTEGER NOT NULL DEFAULT 0,
  quotes_generated INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_user_metrics_daily_date ON user_metrics_daily(metric_date);
