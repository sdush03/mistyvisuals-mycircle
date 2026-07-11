CREATE TABLE system_settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL
);

INSERT INTO system_settings (key, value) VALUES (
  'bank_details',
  '{"bankName":"","accountName":"","accountNumber":"","ifscCode":"","upiId":""}'::jsonb
) ON CONFLICT (key) DO NOTHING;
