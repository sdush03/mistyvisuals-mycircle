/**
 * In-Memory Sliding Window Rate Limiter Utility for Fastify
 * High-performance, zero-dependency protection against brute force, DoS, and bot abuse.
 */

const memoryStore = new Map();

// Cleanup expired records every 60 seconds to avoid memory accumulation
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (now > record.resetTime) {
      memoryStore.delete(key);
    }
  }
}, 60000);
if (cleanupTimer.unref) cleanupTimer.unref();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.raw?.socket?.remoteAddress || req.ip || '127.0.0.1';
}

/**
 * Creates a Fastify preHandler rate limit hook.
 * @param {Object} options
 * @param {string} options.name - Identifier for the rate limiter bucket
 * @param {number} options.timeWindowMs - Window size in milliseconds
 * @param {number} options.max - Maximum requests per window
 * @param {Function} [options.keyGenerator] - Custom key generator function
 * @param {string} [options.errorMessage] - User-facing error message
 */
function createRateLimiter(options) {
  const name = options.name || 'default';
  const timeWindowMs = options.timeWindowMs || 60000; // default 1 min
  const max = options.max || 100;
  const errorMessage = options.errorMessage || 'Too many requests. Please try again later.';
  const keyGenerator = options.keyGenerator || (req => getClientIp(req));

  return async function rateLimitHook(req, reply) {
    const rawKey = keyGenerator(req);
    const key = `${name}:${rawKey}`;
    const now = Date.now();

    let record = memoryStore.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + timeWindowMs,
      };
      memoryStore.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);

    reply.header('X-RateLimit-Limit', max);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > max) {
      reply.header('Retry-After', retryAfterSec);
      return reply.code(429).send({
        error: errorMessage,
        retryAfterSeconds: retryAfterSec,
      });
    }
  };
}

module.exports = {
  createRateLimiter,
  getClientIp,
};
