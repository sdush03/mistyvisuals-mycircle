/**
 * PushNotificationService
 *
 * Centralized notification engine for MyCircle.
 * Handles Expo Push Notifications delivery, batching, ticket receipts,
 * and automated template dispatching for guests and celebrations.
 */

const { prisma } = require('../prisma');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100; // Expo maximum messages per request

/**
 * Clean & format couple names from event title
 */
function formatCoupleNames(rawTitle) {
  if (!rawTitle) return 'the couple';
  return rawTitle
    .replace(/['']s\s+Wedding/gi, '')
    .replace(/['']s\s+Celebration/gi, '')
    .replace(/\s+Wedding/gi, '')
    .replace(/\s+Celebration/gi, '')
    .replace(/[·•]/g, ' & ')
    .replace(/[_.-]+/g, ' ')
    .trim();
}

/**
 * Send raw push messages in chunks to Expo Push Service
 * @param {Array<{to: string, title: string, body: string, data?: object, sound?: string, channelId?: string}>} messages
 */
async function sendExpoPushNotifications(messages) {
  if (!messages || messages.length === 0) return { sentCount: 0 };

  const validMessages = messages.filter((m) => {
    return (
      m.to &&
      typeof m.to === 'string' &&
      (m.to.startsWith('ExponentPushToken[') || m.to.startsWith('ExpoPushToken['))
    );
  });

  if (validMessages.length === 0) {
    return { sentCount: 0 };
  }

  let successCount = 0;
  const invalidTokens = [];

  for (let i = 0; i < validMessages.length; i += CHUNK_SIZE) {
    const chunk = validMessages.slice(i, i + CHUNK_SIZE);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[PushNotificationService] Expo API error HTTP ${response.status}:`, errorText);
        continue;
      }

      const result = await response.json();
      const tickets = result.data || [];

      tickets.forEach((ticket, idx) => {
        if (ticket.status === 'ok') {
          successCount++;
        } else if (ticket.status === 'error') {
          console.warn(`[PushNotificationService] Ticket error:`, ticket.message, ticket.details);
          if (ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(chunk[idx].to);
          }
        }
      });
    } catch (chunkErr) {
      console.error('[PushNotificationService] Failed to send push chunk:', chunkErr.message);
    }
  }

  // Deactivate expired/invalid tokens
  if (invalidTokens.length > 0) {
    await prisma.userPushToken.updateMany({
      where: { token: { in: invalidTokens } },
      data: { isActive: false },
    }).catch(() => {});
  }

  return { sentCount: successCount, total: validMessages.length };
}

/**
 * Retrieve active push tokens for guests of an event
 * @param {number} eventId
 * @param {object} [options]
 * @param {string[]} [options.emails] Optional filter by specific emails
 * @param {number[]} [options.userIds] Optional filter by specific userIds
 */
async function getEventGuestTokens(eventId, options = {}) {
  const { emails, userIds } = options;

  const emailFilter = emails && emails.length > 0 ? [...new Set([
    ...emails,
    ...emails.map(e => e.toLowerCase()),
    ...emails.map(e => e.trim())
  ])] : null;

  const guests = await prisma.guest.findMany({
    where: {
      eventId,
      isBlocked: false,
      ...(emailFilter ? { email: { in: emailFilter } } : {}),
    },
    select: { id: true, email: true, circleUser: { select: { id: true } } },
  });

  const guestEmails = [...new Set([
    ...guests.map(g => g.email).filter(Boolean),
    ...guests.map(g => g.email?.toLowerCase()).filter(Boolean),
  ])];
  const guestUserIds = guests.map(g => g.circleUser?.id).filter(Boolean);
  const guestIds = guests.map(g => g.id).filter(Boolean);

  const orConditions = [
    ...(guestEmails.length > 0 ? [{ email: { in: guestEmails } }] : []),
    ...(guestUserIds.length > 0 ? [{ userId: { in: guestUserIds } }] : []),
    ...(guestIds.length > 0 ? [{ guestId: { in: guestIds } }] : []),
    ...(userIds && userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
  ];

  if (orConditions.length === 0) {
    return [];
  }

  const tokenRecords = await prisma.userPushToken.findMany({
    where: {
      isActive: true,
      OR: orConditions,
    },
    select: { token: true, email: true, userId: true },
  });

  return tokenRecords;
}

// ════════════════════════════════════════════════════════════════════════════
// TEMPLATES (AUTOMATED SCENARIO DISPATCHERS)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 1. New Photos of You Spotted (Option A)
 * Fired when new photos match a guest's selfie vector
 */
async function notifyNewFaceMatches({ eventId, email, count = 1 }) {
  const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
  if (!event) return;
  const couple = formatCoupleNames(event.title);

  const tokens = await getEventGuestTokens(eventId, { emails: [email] });
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: 'Look who we spotted! ✨',
    body: `We just found some wonderful photos of you from ${couple}’s celebration. Tap to see them!`,
    data: {
      url: `mycircle://celebration/${event.slug}?tab=matched`,
      slug: event.slug,
      tab: 'matched',
      type: 'face_match',
    },
  }));

  return sendExpoPushNotifications(messages);
}

/**
 * 2A. New Ceremony / Tab Added (Option A)
 * Fired when a brand new ceremony tab (Sangeet, Haldi, Reception) is published
 */
async function notifyNewCeremonyTab({ eventId, ceremonyName }) {
  const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
  if (!event || !ceremonyName) return;
  const couple = formatCoupleNames(event.title);

  const tokens = await getEventGuestTokens(eventId);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: `The ${ceremonyName} photos are live! 💃`,
    body: `Every smile, ritual, and dance step from the ${ceremonyName} is now in ${couple}’s gallery. Relive the moments!`,
    data: {
      url: `mycircle://celebration/${event.slug}?tab=${encodeURIComponent(ceremonyName)}`,
      slug: event.slug,
      tab: ceremonyName,
      type: 'new_tab',
    },
  }));

  return sendExpoPushNotifications(messages);
}

/**
 * 2B. More Photos Added to an Existing Album (Option B + Ceremony name)
 * Fired when more photos are uploaded to an existing ceremony/album
 */
async function notifyMorePhotosAdded({ eventId, ceremonyName = 'celebration' }) {
  const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
  if (!event) return;
  const couple = formatCoupleNames(event.title);

  const tokens = await getEventGuestTokens(eventId);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: 'The gallery just got bigger! 🎉',
    body: `More candid moments from the ${ceremonyName} have arrived in ${couple}’s celebration. Tap to view the new shots!`,
    data: {
      url: `mycircle://celebration/${event.slug}?tab=${encodeURIComponent(ceremonyName)}`,
      slug: event.slug,
      tab: ceremonyName,
      type: 'more_photos',
    },
  }));

  return sendExpoPushNotifications(messages);
}

/**
 * 3A. Cinematic Highlight / Trailer Premiere (Option B)
 */
async function notifyCinemaHighlight({ eventId }) {
  const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
  if (!event) return;
  const couple = formatCoupleNames(event.title);

  const tokens = await getEventGuestTokens(eventId);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: 'The wedding film is here ✨',
    body: `All the tears, laughter, and vows in one beautiful film. Watch ${couple}’s highlight film now.`,
    data: {
      url: `mycircle://celebration/${event.slug}?tab=cinema&category=directors_cut`,
      slug: event.slug,
      tab: 'cinema',
      category: 'directors_cut',
      type: 'cinema_trailer',
    },
  }));

  return sendExpoPushNotifications(messages);
}

/**
 * 3B. Reels & Candid Diaries (Option B with Popcorn emoji 🍿)
 */
async function notifyCandidReels({ eventId }) {
  const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
  if (!event) return;
  const couple = formatCoupleNames(event.title);

  const tokens = await getEventGuestTokens(eventId);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: 'The candid moments are in 🍿',
    body: `Catch the real, untold moments from ${couple}’s celebration in Cinema!`,
    data: {
      url: `mycircle://celebration/${event.slug}?tab=cinema&category=candid`,
      slug: event.slug,
      tab: 'cinema',
      category: 'candid',
      type: 'cinema_reel',
    },
  }));

  return sendExpoPushNotifications(messages);
}

/**
 * 3C. Stage & Spotlight / Dance Performances (Option A)
 */
async function notifyDancePerformances({ eventId }) {
  const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
  if (!event) return;

  const tokens = await getEventGuestTokens(eventId);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: 'The dance floor is on fire! 💃🕺',
    body: 'All the Sangeet stage performances are live in Cinema. Go watch your squad’s moves!',
    data: {
      url: `mycircle://celebration/${event.slug}?tab=cinema&category=stage`,
      slug: event.slug,
      tab: 'cinema',
      category: 'stage',
      type: 'cinema_dance',
    },
  }));

  return sendExpoPushNotifications(messages);
}

/**
 * 3D. The Extended Cuts / Full Ceremony Chapters (Option B)
 */
async function notifyExtendedCuts({ eventId }) {
  const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
  if (!event) return;

  const tokens = await getEventGuestTokens(eventId);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: 'The full story is here 🎞️',
    body: 'Watch the complete ceremony chapters and heartfelt moments in full length.',
    data: {
      url: `mycircle://celebration/${event.slug}?tab=cinema&category=extended`,
      slug: event.slug,
      tab: 'cinema',
      category: 'extended',
      type: 'cinema_extended',
    },
  }));

  return sendExpoPushNotifications(messages);
}

/**
 * 3E. "Coming Soon" Teaser Poster Drop (Option A)
 */
async function notifyComingSoonTeaser({ eventId }) {
  const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
  if (!event) return;
  const couple = formatCoupleNames(event.title);

  const tokens = await getEventGuestTokens(eventId);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: 'Something beautiful is coming... 🎞️',
    body: `Sneak peek! The official film teaser poster for ${couple}’s wedding just dropped in Cinema.`,
    data: {
      url: `mycircle://celebration/${event.slug}?tab=cinema`,
      slug: event.slug,
      tab: 'cinema',
      type: 'cinema_coming_soon',
    },
  }));

  return sendExpoPushNotifications(messages);
}

/**
 * 3F. Universal Updated Video Version (Option 1)
 * Fired when a newly edited version of any video (trailer, reel, dance, or film) is uploaded
 */
async function notifyUpdatedVideoVersion({ eventId, videoTitle = 'the video', videoId }) {
  const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
  if (!event) return;

  const tokens = await getEventGuestTokens(eventId);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: 'A fresh cut just dropped! 🌟',
    body: `We just updated "${videoTitle}" with the latest edits. Tap to watch the new version!`,
    data: {
      url: `mycircle://celebration/${event.slug}?tab=cinema${videoId ? `&videoId=${videoId}` : ''}`,
      slug: event.slug,
      tab: 'cinema',
      videoId: videoId ? String(videoId) : undefined,
      type: 'cinema_updated_version',
    },
  }));

  return sendExpoPushNotifications(messages);
}

/**
 * 4. Initial Gallery Launch (Option C)
 * Fired when the very first photos of the wedding go live
 */
async function notifyInitialGalleryLaunch({ eventId }) {
  const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
  if (!event) return;
  const couple = formatCoupleNames(event.title);

  const tokens = await getEventGuestTokens(eventId);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: 'The gallery is officially live ✨',
    body: `Every special moment from ${couple}’s celebration is ready for you to explore.`,
    data: {
      url: `mycircle://celebration/${event.slug}`,
      slug: event.slug,
      type: 'gallery_launch',
    },
  }));

  return sendExpoPushNotifications(messages);
}

/**
 * 5. Standalone App Onboarding: Incomplete Signup / Missing Selfie (Option A)
 * For users who started signup but closed the app before completing their selfie.
 */
async function notifyIncompleteSignupSelfie(tokenString) {
  if (!tokenString) return;

  const messages = [
    {
      to: tokenString,
      sound: 'default',
      title: 'You’re almost there! ✨',
      body: 'Complete your profile with a quick selfie so we can personalize your experience. Tap to finish setup!',
      data: {
        url: 'mycircle://onboarding/selfie',
        type: 'onboarding_selfie',
      },
    },
  ];

  return sendExpoPushNotifications(messages);
}

/**
 * 7. Instant Face Matches Upon Joining (Option A)
 * Fired immediately when a guest joins a celebration and matches are instantly found
 */
async function notifyInstantFaceMatches({ token, count = 1, slug, coupleNames }) {
  if (!token) return;

  const messages = [
    {
      to: token,
      sound: 'default',
      title: 'Found you in the crowd! 🥂',
      body: `We found ${count} photos of you in ${coupleNames || 'the'} celebration! Tap to see how great you looked.`,
      data: {
        url: `mycircle://celebration/${slug}?tab=matched`,
        slug,
        tab: 'matched',
        type: 'instant_face_matches',
      },
    },
  ];

  return sendExpoPushNotifications(messages);
}

/**
 * 11. Celebration Anniversaries & Memory Rewinds
 * @param {'1_month' | 'upcoming_1_year' | '1_year'} type
 */
async function notifyAnniversary({ eventId, type = '1_year' }) {
  const event = await prisma.galleryEvent.findUnique({ where: { id: eventId } });
  if (!event) return;
  const couple = formatCoupleNames(event.title);

  const tokens = await getEventGuestTokens(eventId);
  if (tokens.length === 0) return;

  let title = '1 year ago today! 💍🎉';
  let body = `Happy 1st Anniversary to ${couple}! Celebrate the milestone by reliving all the wonderful memories from this day.`;

  if (type === '1_month') {
    title = `1 month of ${couple}! 🥂`;
    body = `Can you believe it’s already been a month? Relive your favorite moments from the celebration today.`;
  } else if (type === 'upcoming_1_year') {
    title = 'Almost 1 year since the big day! ✨';
    body = `${couple}’s 1st anniversary is coming up in just a few days! Take a trip down memory lane and look back at the photos.`;
  }

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title,
    body,
    data: {
      url: `mycircle://celebration/${event.slug}`,
      slug: event.slug,
      type: `anniversary_${type}`,
    },
  }));

  return sendExpoPushNotifications(messages);
}

module.exports = {
  sendExpoPushNotifications,
  getEventGuestTokens,
  notifyNewFaceMatches,
  notifyNewCeremonyTab,
  notifyMorePhotosAdded,
  notifyCinemaHighlight,
  notifyCandidReels,
  notifyDancePerformances,
  notifyExtendedCuts,
  notifyComingSoonTeaser,
  notifyUpdatedVideoVersion,
  notifyInitialGalleryLaunch,
  notifyIncompleteSignupSelfie,
  notifyInstantFaceMatches,
  notifyAnniversary,
  formatCoupleNames,
};
