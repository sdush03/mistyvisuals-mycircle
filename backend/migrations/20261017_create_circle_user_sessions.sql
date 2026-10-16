-- Create circle_user_sessions table for single active device tracking
CREATE TABLE IF NOT EXISTS circle_user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    client_kind VARCHAR(20) NOT NULL,
    device_type VARCHAR(50),
    user_agent TEXT,
    login_at TIMESTAMP DEFAULT NOW(),
    logout_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_circle_sessions_active 
ON circle_user_sessions (user_id, client_kind) WHERE logout_at IS NULL;
