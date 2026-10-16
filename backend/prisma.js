const { PrismaClient, Prisma } = require('@prisma/client')

if (!process.env.DATABASE_URL) {
  const host = process.env.DB_HOST
  const user = process.env.DB_USER
  const name = process.env.DB_NAME
  if (host && user && name) {
    const port = process.env.DB_PORT || 5432
    const password = process.env.DB_PASSWORD
    const auth = password
      ? `${user}:${encodeURIComponent(password)}`
      : user
    process.env.DATABASE_URL = `postgresql://${auth}@${host}:${port}/${name}`
  }
}

if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL)
    const current = url.searchParams.get('options')
    const tzOption = '-c timezone=Asia/Kolkata'
    if (!current) {
      url.searchParams.set('options', tzOption)
    } else if (!current.includes('timezone')) {
      url.searchParams.set('options', `${current} ${tzOption}`)
    }
    // Enforce safe connection pool limit for 2GB RAM DigitalOcean droplet (20 for mycircle high-burst traffic)
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '20')
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '20')
    }
    process.env.DATABASE_URL = url.toString()
  } catch (err) {
    // ignore invalid url, keep as-is
  }
}

const prisma = new PrismaClient()

// Enable SQLite Write-Ahead Logging (WAL) for concurrent non-blocking reads
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
  prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => {})
  prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL;').catch(() => {})
}

module.exports = { prisma, Prisma }
