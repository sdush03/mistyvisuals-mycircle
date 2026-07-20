/**
 * heroContent.ts
 *
 * All editorial copy, message variants and content helpers for the Hero system.
 * The resolver in index.tsx should call these helpers rather than building
 * strings inline.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveMessage {
  /** Primary headline text. */
  h: string;
  /** Supporting subtitle text. */
  s: string;
}

// ─── CTA labels ───────────────────────────────────────────────────────────────

export const HERO_CTA = {
  VIEW_GALLERY:    'View Gallery →',
  VIEW_HIGHLIGHTS: 'View Highlights →',
  RELIVE_GALLERY:  'Relive Gallery →',
} as const;

// ─── Welcome Hero ─────────────────────────────────────────────────────────────

/**
 * Curated editorial subtitles for the Welcome (fallback) Hero.
 * One is selected randomly at app launch and held stable for the session.
 */
export const WELCOME_EDITORIALS: readonly string[] = [
  'Discover beautiful celebrations captured by Misty Visuals.',
  'Every celebration has a story waiting to be explored.',
  'Explore our latest stories, films and moodboards.',
  'Relive beautiful moments and discover new ones.',
  'Love deserves to be remembered beautifully.',
  'Find inspiration through real celebrations.',
  'The finest moments are often the simplest.',
  'Some stories deserve another look.',
];

/**
 * Returns a randomly selected editorial message from WELCOME_EDITORIALS.
 * Call once on component mount and store the result in a ref to keep it
 * stable for the session.
 */
export const pickWelcomeEditorial = (): string =>
  WELCOME_EDITORIALS[Math.floor(Math.random() * WELCOME_EDITORIALS.length)];

/**
 * Builds the time-aware greeting headline for the Welcome Hero.
 * @param firstName  First name of the logged-in user, or empty string.
 * @param hours      Current hour (0–23) from `new Date().getHours()`.
 */
export const buildWelcomeHeadline = (firstName: string, hours: number): string => {
  const greet = hours < 12 ? 'Good Morning' : hours < 17 ? 'Good Afternoon' : 'Good Evening';
  return firstName ? `${greet}, ${firstName}.` : `${greet}.`;
};

// ─── Live Celebration Hero ────────────────────────────────────────────────────

/**
 * Pool of warm, joyful Live Celebration messages.
 * Each entry is a function that optionally accepts the couple's title
 * to produce personalised copy.
 */
export const LIVE_MESSAGE_VARIANTS: ReadonlyArray<(title: string) => LiveMessage> = [
  (title) => ({
    h: `Today, ${title} celebrate their love.`,
    s: 'Wishing them a lifetime of happiness.',
  }),
  (_) => ({
    h: 'What a beautiful day to celebrate together.',
    s: 'Celebrating beautiful beginnings.',
  }),
  (_) => ({
    h: "Here's to love, laughter and a lifetime of memories.",
    s: 'May every moment become a cherished memory.',
  }),
  (_) => ({
    h: 'May today be filled with unforgettable moments.',
    s: 'Celebrating beautiful beginnings.',
  }),
];

/**
 * Picks a random Live message from the pool.
 * The caller is responsible for caching the result (e.g. in a ref) to keep
 * the message stable throughout the LIVE period.
 */
export const pickLiveMessage = (title: string): LiveMessage =>
  LIVE_MESSAGE_VARIANTS[Math.floor(Math.random() * LIVE_MESSAGE_VARIANTS.length)](title);

// ─── Face Matches Hero ────────────────────────────────────────────────────────

/**
 * Returns a grammatically correct memory count label.
 *
 * Examples:
 *   faceMatchCountLabel(1, false) → "a memory"
 *   faceMatchCountLabel(1, true)  → "a new memory"
 *   faceMatchCountLabel(5, false) → "5 memories"
 *   faceMatchCountLabel(5, true)  → "5 new memories"
 */
export const faceMatchCountLabel = (count: number, isNew: boolean): string => {
  if (count === 1) return isNew ? 'a new memory' : 'a memory';
  return isNew ? `${count} new memories` : `${count} memories`;
};

/**
 * Builds the Face Matches headline for a single gallery.
 */
export const buildFaceMatchHeadlineSingle = (count: number, isNew: boolean): string =>
  `We found ${faceMatchCountLabel(count, isNew)} of you.`;

/**
 * Builds the Face Matches headline for multiple galleries.
 */
export const buildFaceMatchHeadlineMulti = (total: number): string =>
  `We found ${total === 1 ? 'a memory' : `${total} memories`} of you.`;

/**
 * Builds the Face Matches subtitle for a single gallery.
 */
export const buildFaceMatchSubtitleSingle = (eventTitle: string): string =>
  `From ${eventTitle}'s celebration.`;

/**
 * Builds the Face Matches subtitle for multiple galleries.
 */
export const buildFaceMatchSubtitleMulti = (count: number): string =>
  `Across ${count} celebrations.`;

// ─── New Highlights Hero ──────────────────────────────────────────────────────

/** Static copy for the Highlights Hero. */
export const HIGHLIGHTS_COPY = {
  /** @param eventTitle  Name of the celebration. */
  headline: (eventTitle: string) => `${eventTitle}'s highlights are ready.`,
  subtitle: 'Relive the most beautiful moments from their celebration.',
} as const;

// ─── Anniversary Hero ─────────────────────────────────────────────────────────

/** Static copy for the Anniversary Hero. */
export const ANNIVERSARY_COPY = {
  todayHeadline: 'One year ago today...',
  /** @param eventTitle  Name of the celebration. */
  todaySubtitle: (eventTitle: string) => `Relive ${eventTitle}'s celebration.`,
  /** @param eventTitle  Name of the celebration. @param days  Days until anniversary. */
  countdownHeadline: (eventTitle: string, days: number) =>
    `${eventTitle} celebrate their anniversary in ${days} ${days === 1 ? 'day' : 'days'}.`,
  countdownSubtitle: 'Relive the memories before the big day.',
} as const;

// ─── Tomorrow / Two Days Hero ─────────────────────────────────────────────────

/** Static copy for the Wedding Tomorrow Hero. */
export const TOMORROW_COPY = {
  headline: 'Tomorrow is the big day.',
  subtitle: "We can't wait to capture every beautiful moment.",
} as const;

/** Static copy for the Wedding in Two Days Hero. */
export const TWO_DAYS_COPY = {
  headline: 'Just 2 days to go.',
  subtitle: 'The celebrations begin very soon.',
} as const;

// ─── Upcoming Hero ────────────────────────────────────────────────────────────

/** Static copy for the Upcoming Hero. */
export const UPCOMING_COPY = {
  /** @param eventTitle  Name of the celebration. @param days  Days until event. */
  headline: (eventTitle: string, days: number) =>
    `${eventTitle} celebrate in ${days} days.`,
  subtitle: 'Looking forward to celebrating together.',
} as const;
