/**
 * Push Token Registration Routes
 * Allows mobile devices to register their Expo Push Tokens,
 * associate them with authenticated users/guests, and toggle preferences.
 */

const { prisma } = require('../prisma');

module.exports = async function pushTokenRoutes(fastify, opts) {

  // Helper to extract authenticated user info if token is present
  function tryExtractAuth(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded = fastify.jwt.verify(token);
        return {
          userId: decoded.userId || null,
          guestId: decoded.guestId || null,
          email: decoded.email || null,
        };
      } catch (_) {}
    }
    return { userId: null, guestId: null, email: null };
  }

  // ── Register / Upsert Device Push Token ──
  fastify.post('/api/user/push-token', async (req, reply) => {
    const { token, platform, isActive } = req.body || {};

    if (!token || typeof token !== 'string') {
      return reply.code(400).send({ error: 'Push token is required' });
    }

    const auth = tryExtractAuth(req);

    try {
      const record = await prisma.userPushToken.upsert({
        where: { token },
        update: {
          ...(auth.userId ? { userId: auth.userId } : {}),
          ...(auth.guestId ? { guestId: auth.guestId } : {}),
          ...(auth.email ? { email: auth.email } : {}),
          ...(platform ? { platform: String(platform).toLowerCase() } : {}),
          isActive: isActive !== false,
          updatedAt: new Date(),
        },
        create: {
          token,
          userId: auth.userId || null,
          guestId: auth.guestId || null,
          email: auth.email || null,
          platform: platform ? String(platform).toLowerCase() : null,
          isActive: isActive !== false,
        },
      });

      return { status: 'success', id: record.id };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to save push token' });
    }
  });

  // ── Deactivate / Unregister Push Token (Logout) ──
  fastify.delete('/api/user/push-token', async (req, reply) => {
    const { token } = req.body || {};
    if (!token) return reply.code(400).send({ error: 'Token is required' });

    try {
      await prisma.userPushToken.updateMany({
        where: { token },
        data: { isActive: false, updatedAt: new Date() },
      });
      return { status: 'success' };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to deactivate token' });
    }
  });

  // ── Update Notification Preferences Toggle ──
  fastify.patch('/api/user/push-preferences', async (req, reply) => {
    const { token, isActive } = req.body || {};
    if (!token || typeof isActive !== 'boolean') {
      return reply.code(400).send({ error: 'Token and isActive boolean are required' });
    }

    try {
      await prisma.userPushToken.updateMany({
        where: { token },
        data: { isActive, updatedAt: new Date() },
      });
      return { status: 'success' };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to update preferences' });
    }
  });

  // ── Developer / Admin Test Push ──
  fastify.post('/api/user/push-test', async (req, reply) => {
    const { token, title, body, data } = req.body || {};
    if (!token) return reply.code(400).send({ error: 'Token is required' });

    const { sendExpoPushNotifications } = require('../services/pushNotificationService');
    const result = await sendExpoPushNotifications([
      {
        to: token,
        title: title || 'Test Celebration Alert ✨',
        body: body || 'This is a test notification from MyCircle.',
        data: data || { test: true },
        sound: 'default',
      },
    ]);

    return { status: 'success', result };
  });
};
