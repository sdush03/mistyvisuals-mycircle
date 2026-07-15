const { prisma } = require('../prisma');

// Middleware helper to verify guest JWT token
async function verifyGuestAuth(req, reply) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return reply.code(401).send({ error: 'Missing or invalid token' });
    }

    // Access fastify instance via req.server
    const decoded = req.server.jwt.verify(token);
    let isAdminPreview = false;
    if (decoded.role !== 'guest') {
      if (decoded.isAdminPreview && req.params.slug && decoded.slug.toLowerCase().trim() === req.params.slug.toLowerCase().trim()) {
        isAdminPreview = true;
      } else {
        return reply.code(403).send({ error: 'Access denied' });
      }
    }

    let event = null;
    // Validate JWT eventId matches the URL slug to prevent cross-event access
    if (req.params.slug) {
      event = await prisma.galleryEvent.findUnique({
        where: { slug: req.params.slug.toLowerCase().trim() }
      });
      if (!event) {
        return reply.code(404).send({ error: 'Event not found' });
      }
      if (!isAdminPreview && event.id !== decoded.eventId) {
        return reply.code(403).send({ error: 'Token does not match this event' });
      }
      if (!event.active && !isAdminPreview) {
        return reply.code(403).send({ error: 'Gallery is inactive' });
      }
      req.event = event; // Cache the event for downstream handlers
    }

    let guestId = decoded.guestId;
    if (isAdminPreview && event) {
      // Find or create the Admin Preview guest
      let adminGuest = await prisma.guest.findFirst({
        where: { eventId: event.id, email: 'admin@mistyvisuals.com' }
      });
      if (!adminGuest) {
        adminGuest = await prisma.guest.create({
          data: {
            eventId: event.id,
            email: 'admin@mistyvisuals.com',
            name: 'Admin Preview',
            provider: 'system',
            providerId: 'admin-preview',
            hasFullAccess: true
          }
        });
      }
      guestId = adminGuest.id;
    }

    // Fetch guest status from database to get the real-time access level
    const dbGuest = await prisma.guest.findUnique({
      where: { id: guestId }
    });
    req.guest = {
      ...decoded,
      guestId,
      role: 'guest',
      hasFullAccess: dbGuest ? dbGuest.hasFullAccess : decoded.hasFullAccess,
      isPreviewMode: isAdminPreview
    };
  } catch (err) {
    return reply.code(401).send({ error: 'Unauthorized session' });
  }
}

module.exports = { verifyGuestAuth };
