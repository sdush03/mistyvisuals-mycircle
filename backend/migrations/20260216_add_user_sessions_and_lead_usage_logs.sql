CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  login_at TIMESTAMP NOT NULL DEFAULT NOW(),
  logout_at TIMESTAMP NULL,
  duration_seconds INTEGER NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS lead_usage_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  entered_at TIMESTAMP NOT NULL DEFAULT NOW(),
  left_at TIMESTAMP NULL,
  duration_seconds INTEGER NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_usage_logs_user_id ON lead_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_usage_logs_lead_id ON lead_usage_logs(lead_id);
