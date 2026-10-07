CREATE TABLE IF NOT EXISTS user_push_tokens (
  id SERIAL PRIMARY KEY,
  user_id INT,
  guest_id INT,
  email VARCHAR(255),
  token VARCHAR(255) UNIQUE NOT NULL,
  platform VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_guest_id ON user_push_tokens(guest_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_email ON user_push_tokens(email);
