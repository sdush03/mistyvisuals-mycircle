/**
 * Daily Notification Jobs
 *
 * Runs background maintenance checks:
 * 1. Nudge users who downloaded the app but dropped off before completing their selfie (Scenario 5).
 * 2. Send 1-month, upcoming 1-year, and 1-year celebration anniversary notifications to guests (Scenario 11).
 *
 * Uses `smart_notification_log` table to ensure 100% idempotent single delivery.
 */

const { prisma } = require('../prisma');
const pushService = require('../services/pushNotificationService');

/**
 * Check if a notification key was already delivered today or previously
 */
async function hasBeenDelivered(key) {
  try {
    const existing = await prisma.smart_notification_log.findFirst({
      where: { notif_key: key },
    });
    return !!existing;
  } catch (_) {
    return false;
  }
}

/**
 * Record delivery in smart_notification_log
 */
async function markDelivered(key) {
  try {
    await prisma.smart_notification_log.create({
      data: {
        notif_key: key,
        sent_date: new Date(),
      },
    });
  } catch (_) {}
}

/**
 * Scenario 5: Nudge users who downloaded the app >= 24h ago with incomplete selfie
 */
async function processIncompleteSignupSelfies() {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);

    // Find active push tokens registered between 24h and 72h ago
    const candidateTokens = await prisma.userPushToken.findMany({
      where: {
        isActive: true,
        createdAt: { lte: twentyFourHoursAgo, gte: seventyTwoHoursAgo },
      },
    });

    for (const record of candidateTokens) {
      const logKey = `onboarding_selfie_${record.token}`;
      if (await hasBeenDelivered(logKey)) continue;

      let hasSelfie = false;
      if (record.userId) {
        const user = await prisma.circleUser.findUnique({
          where: { id: record.userId },
          select: { selfieVector: true },
        });
        hasSelfie = !!(user && user.selfieVector);
      } else if (record.email) {
        const user = await prisma.circleUser.findUnique({
          where: { email: record.email },
          select: { selfieVector: true },
        });
        hasSelfie = !!(user && user.selfieVector);
      }

      if (!hasSelfie) {
        await pushService.notifyIncompleteSignupSelfie(record.token);
        await markDelivered(logKey);
        console.log(`[DailyJobs] Sent incomplete selfie nudge to token: ${record.token.slice(0, 20)}...`);
      }
    }
  } catch (err) {
    console.warn('[DailyJobs] processIncompleteSignupSelfies error:', err.message);
  }
}

/**
 * Scenario 11: 1 Month, Upcoming 1 Year (7 days before), and 1 Year Anniversary
 */
async function processCelebrationAnniversaries() {
  try {
    const events = await prisma.galleryEvent.findMany({
      where: { active: true },
      select: { id: true, title: true, slug: true, date: true },
    });

    const now = new Date();
    const todayMonth = now.getMonth();
    const todayDate = now.getDate();
    const todayYear = now.getFullYear();

    for (const ev of events) {
      if (!ev.date) continue;
      const evDate = new Date(ev.date);
      const evYear = evDate.getFullYear();
      const evMonth = evDate.getMonth();
      const evDay = evDate.getDate();

      // ── 1. Exactly 1 Month Anniversary ──
      // Event date + 1 month roughly matches today
      const oneMonthTarget = new Date(evYear, evMonth + 1, evDay);
      const diffDaysOneMonth = Math.round((now - oneMonthTarget) / (1000 * 60 * 60 * 24));
      if (diffDaysOneMonth === 0) {
        const key = `anniv_1_month_${ev.id}_${todayYear}`;
        if (!(await hasBeenDelivered(key))) {
          await pushService.notifyAnniversary({ eventId: ev.id, type: '1_month' });
          await markDelivered(key);
          console.log(`[DailyJobs] Dispatched 1-Month Anniversary for ${ev.title}`);
        }
      }

      // ── 2. Upcoming 1-Year Anniversary (7 days before) ──
      const oneYearTarget = new Date(evYear + 1, evMonth, evDay);
      const diffDaysUpcoming = Math.round((oneYearTarget - now) / (1000 * 60 * 60 * 24));
      if (diffDaysUpcoming === 7) {
        const key = `anniv_upcoming_1_year_${ev.id}_${todayYear}`;
        if (!(await hasBeenDelivered(key))) {
          await pushService.notifyAnniversary({ eventId: ev.id, type: 'upcoming_1_year' });
          await markDelivered(key);
          console.log(`[DailyJobs] Dispatched Upcoming 1-Year Anniversary for ${ev.title}`);
        }
      }

      // ── 3. Exact 1-Year Anniversary ──
      const diffDaysOneYear = Math.round((now - oneYearTarget) / (1000 * 60 * 60 * 24));
      if (diffDaysOneYear === 0) {
        const key = `anniv_1_year_${ev.id}_${todayYear}`;
        if (!(await hasBeenDelivered(key))) {
          await pushService.notifyAnniversary({ eventId: ev.id, type: '1_year' });
          await markDelivered(key);
          console.log(`[DailyJobs] Dispatched 1-Year Anniversary for ${ev.title}`);
        }
      }
    }
  } catch (err) {
    console.warn('[DailyJobs] processCelebrationAnniversaries error:', err.message);
  }
}

/**
 * Initialize background cron runner
 */
function startDailyNotificationJobs() {
  // Run on startup after 1 minute delay
  setTimeout(() => {
    processIncompleteSignupSelfies();
    processCelebrationAnniversaries();
  }, 60 * 1000);

  // Run every 6 hours
  setInterval(() => {
    processIncompleteSignupSelfies();
    processCelebrationAnniversaries();
  }, 6 * 60 * 60 * 1000);

  console.log('[DailyJobs] Automated push notification scheduler initialized.');
}

module.exports = {
  startDailyNotificationJobs,
  processIncompleteSignupSelfies,
  processCelebrationAnniversaries,
};
