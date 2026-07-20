/**
 * heroConfig.ts
 *
 * All Hero system configuration: durations, visibility windows and
 * AsyncStorage keys. Import from here — never hardcode numbers or
 * key strings inside components.
 */

// ─── Visibility durations ─────────────────────────────────────────────────────

/** Duration constants in days (human-readable source of truth). */
export const HERO_DURATION_DAYS = {
  /** Face Matches hero remains visible for 7 days from first discovery. */
  FACE_MATCHES: 7,
  /** Highlights hero remains visible for 21 days from first discovery. */
  HIGHLIGHTS: 21,
  /** Anniversary countdown window: show hero when anniversary is ≤14 days away. */
  ANNIVERSARY: 14,
} as const;

/** Pre-computed millisecond values derived from HERO_DURATION_DAYS. */
export const HERO_EXPIRY_MS = {
  FACE_MATCHES:  HERO_DURATION_DAYS.FACE_MATCHES  * 24 * 60 * 60 * 1000,
  HIGHLIGHTS:    HERO_DURATION_DAYS.HIGHLIGHTS     * 24 * 60 * 60 * 1000,
  ANNIVERSARY:   HERO_DURATION_DAYS.ANNIVERSARY    * 24 * 60 * 60 * 1000,
} as const;

// ─── Fade transition timings (ms) ────────────────────────────────────────────

export const HERO_TRANSITION = {
  /** Fade-out duration when hero type changes. */
  FADE_OUT_MS: 120,
  /** Fade-in duration after the new hero content mounts. */
  FADE_IN_MS: 200,
} as const;

// ─── AsyncStorage keys ────────────────────────────────────────────────────────

/** Centralised storage key registry — change a key in one place only. */
export const HERO_STORAGE_KEYS = {
  FACE_MATCHES:  '@mycircle_hero_seen_data',
  HIGHLIGHTS:    '@mycircle_highlights_hero_data',
} as const;

// ─── Priority order (informational — actual order defined by evaluator array) ─

/**
 * Ordered list of Hero types from highest to lowest priority.
 * This is documentation/reference only; the resolver array in index.tsx
 * defines the real execution order.
 */
export const HERO_PRIORITY_ORDER = [
  'NEW_MATCHES',
  'NEW_HIGHLIGHTS',
  'ANNIVERSARY',
  'LIVE',
  'TOMORROW',
  'TWO_DAYS',
  'UPCOMING',
  'WELCOME',
] as const;
