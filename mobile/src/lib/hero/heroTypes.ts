/**
 * heroTypes.ts
 *
 * Single source of truth for all Hero type identifiers.
 * Import HeroType (or HeroTypeValue) everywhere a hero type string is needed
 * to avoid scattered literals and typos.
 */

export const HeroType = {
  FACE_MATCHES:   'NEW_MATCHES',
  HIGHLIGHTS:     'NEW_HIGHLIGHTS',
  ANNIVERSARY:    'ANNIVERSARY',
  LIVE:           'LIVE',
  TOMORROW:       'TOMORROW',
  TWO_DAYS:       'TWO_DAYS',
  UPCOMING:       'UPCOMING',
  WELCOME:        'WELCOME',
} as const;

/** Union of every valid Hero type string. */
export type HeroTypeValue = typeof HeroType[keyof typeof HeroType];

/** Shape of a resolved Hero card passed to the renderer. */
export interface HeroCard {
  type: HeroTypeValue;
  headline: string;
  subtitle: string;
  /** Empty string means no CTA button is rendered. */
  cta: string;
  /** null for heroes that do not navigate anywhere (e.g. WELCOME, LIVE). */
  eventSlug: string | null;
}
