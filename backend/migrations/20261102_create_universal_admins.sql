CREATE TABLE IF NOT EXISTS universal_admins (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES circle_users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_universal_admins_user_id ON universal_admins(user_id);
