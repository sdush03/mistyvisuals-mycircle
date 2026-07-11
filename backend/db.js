const { Pool } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL

const hasDatabaseUrl = Boolean(DATABASE_URL)
const hasDbVars =
  process.env.DB_HOST &&
  process.env.DB_USER &&
  process.env.DB_NAME

if (!hasDatabaseUrl && !hasDbVars) {
  throw new Error(
    'Database configuration missing. Set DATABASE_URL or DB_HOST/DB_USER/DB_NAME.'
  )
}

if (!hasDatabaseUrl) {
  const missing = []
  if (!process.env.DB_HOST) missing.push('DB_HOST')
  if (!process.env.DB_USER) missing.push('DB_USER')
  if (!process.env.DB_NAME) missing.push('DB_NAME')
  if (process.env.DB_PASSWORD === undefined) missing.push('DB_PASSWORD')
  if (missing.length) {
    throw new Error(
      `Database configuration missing: ${missing.join(', ')}`
    )
  }
}

const pool = hasDatabaseUrl
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    })
  : new Pool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: Number(process.env.DB_PORT || 5432),
    })

pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'UTC'").catch(() => {})
})

module.exports = { pool }
