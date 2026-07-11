-- Roles + user_roles (multi-role), relax email nullability, unique phone

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

-- Seed roles
INSERT INTO roles (key, label) VALUES
  ('admin', 'Admin'),
  ('sales', 'Sales'),
  ('marketing', 'Marketing'),
  ('photographer', 'Photographer'),
  ('cinematographer', 'Cinematographer'),
  ('photo_editor', 'Photo Editor'),
  ('video_editor', 'Video Editor'),
  ('creative_director', 'Creative Director'),
  ('finance', 'Finance')
ON CONFLICT (key) DO NOTHING;

-- Backfill user_roles from legacy users.role
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.key = u.role
ON CONFLICT DO NOTHING;

-- Allow nullable email (unique constraint allows multiple NULLs)
ALTER TABLE users
  ALTER COLUMN email DROP NOT NULL;

-- Unique phone when present
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_not_null
  ON users (phone)
  WHERE phone IS NOT NULL;

