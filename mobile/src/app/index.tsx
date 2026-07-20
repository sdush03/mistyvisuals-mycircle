import React, { useEffect, useState, useRef, useCallback } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  ScrollView, 
  Image, 
  Pressable, 
  Platform, 
  ActivityIndicator, 
  Dimensions, 
  SafeAreaView, 
  StatusBar,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';

import { Linking } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import {
  HeroType,
  type HeroCard,
  HERO_EXPIRY_MS,
  HERO_TRANSITION,
  HERO_STORAGE_KEYS,
  pickWelcomeEditorial,
  pickLiveMessage,
  buildWelcomeHeadline,
  buildFaceMatchHeadlineSingle,
  buildFaceMatchHeadlineMulti,
  buildFaceMatchSubtitleSingle,
  buildFaceMatchSubtitleMulti,
  HIGHLIGHTS_COPY,
  ANNIVERSARY_COPY,
  TOMORROW_COPY,
  TWO_DAYS_COPY,
  UPCOMING_COPY,
  HERO_CTA,
} from '../lib/hero';

// Sub-components for reading/exploring
import FeaturedStoryView from '../components/home/FeaturedStoryView';
import ArticleView from '../components/home/ArticleView';
import MoodboardsView, { CURATED_MOODBOARDS } from '../components/home/MoodboardsView';
import AllStoriesView from '../components/home/AllStoriesView';

const { width } = Dimensions.get('window');

// Local Data Definitions for the Editorial Showcase
const VIBES = ['All', 'Luxury', 'Destination', 'Intimate', 'Traditional'];

export default function HomeScreen() {
  const { token, profile, setEventDetails } = useAuthStore();
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedVibe, setSelectedVibe] = useState('All');

  // Modals for full articles / portfolios / moodboards
  const [selectedStory, setSelectedStory] = useState<any | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<any | null>(null);
  const [playingFilmId, setPlayingFilmId] = useState<string | null>(null);
  const [isMoodboardsOpen, setIsMoodboardsOpen] = useState(false);
  const [selectedMoodboardId, setSelectedMoodboardId] = useState<string | null>(null);
  const [isAllStoriesOpen, setIsAllStoriesOpen] = useState(false);

  const [websiteStories, setWebsiteStories] = useState<any[]>([]);
  const [websiteFilms, setWebsiteFilms] = useState<any[]>([]);
  const [likedPhotos, setLikedPhotos] = useState<any[]>([]);

  // Hero seen data: tracks first-discovery time + last-seen count per event slug
  // Used for B+D combined expiry: show 7 days from first discovery OR on new photos
  const [heroSeenData, setHeroSeenData] = useState<Record<string, { lastSeenCount: number; firstSeenAt: number }>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);

  // Highlights Hero visibility: { firstShownAt, lastSeenCount } per slug
  // firstShownAt starts the 21-day window; resets when highlightsPhotoCount increases
  const [highlightsHeroData, setHighlightsHeroData] = useState<Record<string, { firstShownAt: number; lastSeenCount: number }>>({});

  // Welcome Hero editorial rotation — pick once per session, session-stable via ref
  const welcomeEditorialRef = React.useRef<string>(pickWelcomeEditorial());

  // Live Hero message stability — keyed by slug, picks once per LIVE period
  const liveMessageRef = React.useRef<Record<string, { h: string; s: string }>>({});
  const getStableLiveMessage = (slug: string, title: string): { h: string; s: string } => {
    if (!liveMessageRef.current[slug]) {
      liveMessageRef.current[slug] = pickLiveMessage(title);
    }
    return liveMessageRef.current[slug];
  };

  // Hero fade transition — fades out to 0 then back to 1 whenever the hero type changes
  const heroFadeAnim = React.useRef(new Animated.Value(1)).current;
  const prevHeroTypeRef = React.useRef<string | null>(null);

  // Load liked photos from storage
  useEffect(() => {
    AsyncStorage.getItem('@mycircle_liked_photos')
      .then((stored) => {
        if (stored) setLikedPhotos(JSON.parse(stored));
      })
      .catch(() => {});
  }, []);

  // Filter featured films ONLY (curated website featured films)
  const featuredFilmsOnly = React.useMemo(() => {
    return websiteFilms.filter((f: any) => f.is_featured || f.isFeatured || websiteFilms.every(item => !item.is_featured));
  }, [websiteFilms]);

  // Helper to extract YouTube 11-char video ID
  const extractYouTubeId = (film: any): string | null => {
    if (!film) return null;
    if (film.youtube_video_id) return film.youtube_video_id;
    const targetUrl = film.youtube_url || film.video_url || '';
    const match = targetUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    return match ? match[1] : null;
  };

  // Load cached stories, films, heroSeenData & events from AsyncStorage on mount for instant Frame 1 rendering
  useEffect(() => {
    AsyncStorage.multiGet([
      HERO_STORAGE_KEYS.FACE_MATCHES,
      HERO_STORAGE_KEYS.HIGHLIGHTS,
      '@mycircle_user_events_cache',
      '@mycircle_cached_website_stories',
      '@mycircle_cached_website_films',
    ])
      .then(([seenDataItem, highlightsItem, eventsItem, storiesItem, filmsItem]) => {
        if (seenDataItem[1]) {
          try { setHeroSeenData(JSON.parse(seenDataItem[1])); } catch (_) {}
        }
        if (highlightsItem[1]) {
          try { setHighlightsHeroData(JSON.parse(highlightsItem[1])); } catch (_) {}
        }
        if (eventsItem[1]) {
          try {
            const cachedEvents = JSON.parse(eventsItem[1]);
            if (Array.isArray(cachedEvents) && cachedEvents.length > 0) {
              setEvents(cachedEvents);
            }
          } catch (_) {}
        }
        if (storiesItem[1]) {
          try {
            const cachedStories = JSON.parse(storiesItem[1]);
            if (Array.isArray(cachedStories) && cachedStories.length > 0) {
              setWebsiteStories(cachedStories);
            }
          } catch (_) {}
        }
        if (filmsItem[1]) {
          try {
            const cachedFilms = JSON.parse(filmsItem[1]);
            if (Array.isArray(cachedFilms) && cachedFilms.length > 0) {
              setWebsiteFilms(cachedFilms);
            }
          } catch (_) {}
        }
      })
      .catch(() => {})
      .finally(() => setCountsLoaded(true));
  }, []);

  // Fetch featured stories & films from website API in background
  useEffect(() => {
    const fetchWebsiteData = async () => {
      try {
        const storiesRes = await fetch('https://www.mistyvisuals.com/api/website/stories');
        if (storiesRes.ok) {
          const storiesData = await storiesRes.json();
          if (Array.isArray(storiesData) && storiesData.length > 0) {
            setWebsiteStories(storiesData);
            AsyncStorage.setItem('@mycircle_cached_website_stories', JSON.stringify(storiesData)).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('Failed to fetch website stories:', e);
      }

      try {
        const filmsRes = await fetch('https://www.mistyvisuals.com/api/website/films');
        if (filmsRes.ok) {
          const filmsData = await filmsRes.json();
          if (Array.isArray(filmsData) && filmsData.length > 0) {
            setWebsiteFilms(filmsData);
            AsyncStorage.setItem('@mycircle_cached_website_films', JSON.stringify(filmsData)).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('Failed to fetch website films:', e);
      }
    };
    fetchWebsiteData();
  }, []);

  // Fetch joined wedding events if authenticated
  useEffect(() => {
    const fetchUserEvents = async () => {
      if (!token) {
        setEvents([]);
        AsyncStorage.removeItem('@mycircle_user_events_cache').catch(() => {});
        return;
      }
      try {
        const res = await api.get('/api/gallery/family/events');
        const rawEvents: any[] = res.data.events || [];
        setEvents(rawEvents);
        AsyncStorage.setItem('@mycircle_user_events_cache', JSON.stringify(rawEvents)).catch(() => {});
      } catch (err: any) {
        // 401 means the token is expired/invalid — the API interceptor handles
        // session cleanup. Swallow silently here to avoid a noisy console error.
        if (err?.response?.status !== 401) {
          console.warn('fetchUserEvents failed:', err?.message);
        }
      } finally {
        setLoadingEvents(false);
      }
    };

    fetchUserEvents();
  }, [token]);

  const handleStoryPress = async (story: any) => {
    if (story.slug) {
      try {
        const res = await fetch(`https://www.mistyvisuals.com/api/website/stories/${story.slug}`);
        if (res.ok) {
          const fullStory = await res.json();
          const photos = fullStory.photos || [];
          const galleryImages = photos.map((p: any) => ({ uri: p.file_url_mobile || p.file_url }));
          const coverUri = fullStory.cover_image_mobile_url || fullStory.cover_image_url || fullStory.grid_image_url;
          setSelectedStory({
            id: String(fullStory.id),
            title: fullStory.title,
            subtitle: fullStory.subtitle || fullStory.category || 'Portfolio Story',
            location: fullStory.location || 'Misty Visuals',
            date: fullStory.date || '',
            coverImage: coverUri ? { uri: coverUri } : null,
            description: fullStory.subtitle || 'Unscripted moments and intentional design.',
            images: galleryImages.length > 0 ? galleryImages : (coverUri ? [{ uri: coverUri }] : []),
          });
          return;
        }
      } catch (e) {
        console.warn('Failed to load full story from website:', e);
      }
    }

    setSelectedStory(story);
  };

  // Helper for same-day date comparison
  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  // Lifecycle Stage Resolver:
  // 1. Primary Source of Truth: `ev.stage`
  // 2. Legacy Migration Fallback: executed ONLY if `ev.stage` is null/undefined
  const resolveCanonicalStage = (ev: any, today: Date): 'UPCOMING' | 'LIVE' | 'READY' | 'HIGHLIGHTS' => {
    // 1. Primary Source of Truth
    if (ev.stage) {
      return ev.stage;
    }

    // 2. Temporary Migration Fallback (only executed if ev.stage is null/undefined)
    if (ev.highlightsReady || ev.isHighlights) {
      return 'HIGHLIGHTS';
    }

    const eventDate = new Date(ev.date);
    const isToday = isSameDay(eventDate, today);

    if (eventDate > today && !isToday) {
      return 'UPCOMING';
    }
    if (isToday) {
      return 'LIVE';
    }

    return 'READY';
  };

  // Helper for My Circle card status subtext (Editorial Lifecycle Presentation)
  const getMyCircleStatusCopy = (ev: any, today: Date): string => {
    const eventDate = new Date(ev.date);
    const isToday = isSameDay(eventDate, today);

    // 1. HIGHLIGHTS
    if (ev.stage === 'HIGHLIGHTS' || ev.highlightsReady || ev.isHighlights) {
      return 'Highlights are ready to relive';
    }

    // 2. UPCOMING
    if (ev.stage === 'UPCOMING' || (eventDate > today && !isToday)) {
      const days = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (days <= 1) {
        return 'Wedding tomorrow';
      }
      return `Wedding in ${days} days`;
    }

    // 3. LIVE
    if (ev.stage === 'LIVE' || isToday) {
      return 'Celebration is happening today';
    }

    // 4. CURATING (Begins AFTER wedding day, continues until first gallery is available)
    if (ev.stage === 'CURATING' || (eventDate < today && !isToday && (ev.matchedCount || 0) === 0 && ev.stage !== 'READY')) {
      return 'Currently curating your memories';
    }

    // 5. READY
    return 'Your gallery is ready to explore';
  };

  // ─── Scalable Hero Priority Engine ──────────────────────────────────────────
  const singleHeroCard = React.useMemo((): HeroCard | null => {
    const today = new Date();
    const params = {
      events,
      heroSeenData,
      highlightsHeroData,
      profileName: profile?.name,
      today,
    };

    // ── Hero Priority Registry (8 states, highest → lowest) ──────────────────
    const HERO_PRIORITY_EVALUATORS = [

      // 1. FACE MATCHES — B+D: show 7 days from discovery, or on new photos
      ({ events: evts, heroSeenData: seen }: any): HeroCard | null => {
        const nowMs = Date.now();
        const eventsWithMatches = evts.filter((e: any) => (e.matchedCount || 0) > 0);
        const visibleEvents = eventsWithMatches.filter((e: any) => {
          const seenEntry = seen[e.slug];
          if (!seenEntry) return true;
          const hasNewPhotos = (e.matchedCount || 0) > seenEntry.lastSeenCount;
          const withinWindow = (nowMs - seenEntry.firstSeenAt) < HERO_EXPIRY_MS.FACE_MATCHES;
          return hasNewPhotos || withinWindow;
        });
        if (visibleEvents.length === 0) return null;
        if (visibleEvents.length === 1) {
          const ev = visibleEvents[0];
          const currentCount = ev.matchedCount || 0;
          const seenEntry = seen[ev.slug];
          const prevCount = seenEntry?.lastSeenCount ?? 0;
          const isNew = !!(seenEntry && currentCount > prevCount);
          const diff = isNew ? currentCount - prevCount : currentCount;
          return {
            type: HeroType.FACE_MATCHES,
            headline: buildFaceMatchHeadlineSingle(diff, isNew),
            subtitle: buildFaceMatchSubtitleSingle(ev.title),
            cta: HERO_CTA.VIEW_GALLERY,
            eventSlug: ev.slug,
          };
        } else {
          const total = visibleEvents.reduce((s: number, e: any) => s + (e.matchedCount || 0), 0);
          const top = visibleEvents[0];
          return {
            type: HeroType.FACE_MATCHES,
            headline: buildFaceMatchHeadlineMulti(total),
            subtitle: buildFaceMatchSubtitleMulti(visibleEvents.length),
            cta: HERO_CTA.VIEW_GALLERY,
            eventSlug: top.slug,
          };
        }
      },

      // 2. NEW HIGHLIGHTS — 21-day visibility window, resets on new highlights
      ({ events: evts, today: now, highlightsHeroData: hlData }: any): HeroCard | null => {
        const nowMs = Date.now();
        for (const ev of evts) {
          if (resolveCanonicalStage(ev, now) === 'HIGHLIGHTS') {
            const entry = hlData[ev.slug];
            if (!entry) return null;
            const currentCount = ev.highlightsPhotoCount || 0;
            const hasNewHighlights = currentCount > entry.lastSeenCount;
            const withinWindow = (nowMs - entry.firstShownAt) < HERO_EXPIRY_MS.HIGHLIGHTS;
            if (!hasNewHighlights && !withinWindow) return null;
            return {
              type: HeroType.HIGHLIGHTS,
              headline: HIGHLIGHTS_COPY.headline(ev.title),
              subtitle: HIGHLIGHTS_COPY.subtitle,
              cta: HERO_CTA.VIEW_HIGHLIGHTS,
              eventSlug: ev.slug,
            };
          }
        }
        return null;
      },

      // 3. ANNIVERSARY — today or within 14-day countdown
      ({ events: evts, today: now }: any): HeroCard | null => {
        for (const ev of evts) {
          const eventDate = new Date(ev.date);
          if (eventDate < now && !isSameDay(eventDate, now)) {
            const yr = eventDate.getFullYear();
            const mo = eventDate.getMonth();
            const dy = eventDate.getDate();
            if (yr < now.getFullYear()) {
              let nextAnniv = new Date(now.getFullYear(), mo, dy);
              if (nextAnniv < now && !isSameDay(nextAnniv, now)) {
                nextAnniv = new Date(now.getFullYear() + 1, mo, dy);
              }
              const isToday = isSameDay(nextAnniv, now);
              const daysUntil = Math.ceil((nextAnniv.getTime() - now.getTime()) / 86400000);
              if (isToday) {
                return {
                  type: HeroType.ANNIVERSARY,
                  headline: ANNIVERSARY_COPY.todayHeadline,
                  subtitle: ANNIVERSARY_COPY.todaySubtitle(ev.title),
                  cta: HERO_CTA.RELIVE_GALLERY,
                  eventSlug: ev.slug,
                };
              } else if (daysUntil <= HERO_EXPIRY_MS.ANNIVERSARY / 86400000 && daysUntil > 0) {
                return {
                  type: HeroType.ANNIVERSARY,
                  headline: ANNIVERSARY_COPY.countdownHeadline(ev.title, daysUntil),
                  subtitle: ANNIVERSARY_COPY.countdownSubtitle,
                  cta: HERO_CTA.RELIVE_GALLERY,
                  eventSlug: ev.slug,
                };
              }
            }
          }
        }
        return null;
      },

      // 4. LIVE CELEBRATION — warm, joyful, no CTA, stable message per slug
      ({ events: evts, today: now }: any): HeroCard | null => {
        for (const ev of evts) {
          if (resolveCanonicalStage(ev, now) === 'LIVE') {
            const pick = getStableLiveMessage(ev.slug, ev.title);
            return {
              type: HeroType.LIVE,
              headline: pick.h,
              subtitle: pick.s,
              cta: '',
              eventSlug: ev.slug,
            };
          }
        }
        return null;
      },

      // 5. WEDDING TOMORROW
      ({ events: evts, today: now }: any): HeroCard | null => {
        for (const ev of evts) {
          if (resolveCanonicalStage(ev, now) === 'UPCOMING') {
            const days = Math.ceil((new Date(ev.date).getTime() - now.getTime()) / 86400000);
            if (days === 1) {
              return {
                type: HeroType.TOMORROW,
                headline: TOMORROW_COPY.headline,
                subtitle: TOMORROW_COPY.subtitle,
                cta: '',
                eventSlug: ev.slug,
              };
            }
          }
        }
        return null;
      },

      // 6. WEDDING IN TWO DAYS
      ({ events: evts, today: now }: any): HeroCard | null => {
        for (const ev of evts) {
          if (resolveCanonicalStage(ev, now) === 'UPCOMING') {
            const days = Math.ceil((new Date(ev.date).getTime() - now.getTime()) / 86400000);
            if (days === 2) {
              return {
                type: HeroType.TWO_DAYS,
                headline: TWO_DAYS_COPY.headline,
                subtitle: TWO_DAYS_COPY.subtitle,
                cta: '',
                eventSlug: ev.slug,
              };
            }
          }
        }
        return null;
      },

      // 7. UPCOMING — all other future weddings, no CTA
      ({ events: evts, today: now }: any): HeroCard | null => {
        for (const ev of evts) {
          if (resolveCanonicalStage(ev, now) === 'UPCOMING') {
            const days = Math.ceil((new Date(ev.date).getTime() - now.getTime()) / 86400000);
            if (days > 2) {
              return {
                type: HeroType.UPCOMING,
                headline: UPCOMING_COPY.headline(ev.title, days),
                subtitle: UPCOMING_COPY.subtitle,
                cta: '',
                eventSlug: ev.slug,
              };
            }
          }
        }
        return null;
      },

      // 8. WELCOME — session-stable editorial rotation, time-aware, no CTA
      ({ profileName, today: now }: any): HeroCard => {
        const firstName = profileName ? profileName.split(' ')[0] : '';
        return {
          type: HeroType.WELCOME,
          headline: buildWelcomeHeadline(firstName, now.getHours()),
          subtitle: welcomeEditorialRef.current,
          cta: '',
          eventSlug: null,
        };
      },
    ];

    for (const evaluator of HERO_PRIORITY_EVALUATORS) {
      const card = evaluator(params);
      if (card) return card;
    }
    return null;
  }, [events, heroSeenData, highlightsHeroData, profile?.name, loadingEvents]);

  // Hero fade transition — triggers only when the hero TYPE changes (not on content updates)
  useEffect(() => {
    const currentType = singleHeroCard?.type ?? null;
    if (prevHeroTypeRef.current !== null && prevHeroTypeRef.current !== currentType) {
      // Type changed: fade out → new content renders → fade in
      Animated.sequence([
        Animated.timing(heroFadeAnim, { toValue: 0, duration: HERO_TRANSITION.FADE_OUT_MS, useNativeDriver: true }),
        Animated.timing(heroFadeAnim, { toValue: 1, duration: HERO_TRANSITION.FADE_IN_MS, useNativeDriver: true }),
      ]).start();
    }
    prevHeroTypeRef.current = currentType;
  }, [singleHeroCard?.type]);

  // When events arrive: initialise / reset highlightsHeroData for any event in HIGHLIGHTS stage.
  // - First detection: set firstShownAt=now, lastSeenCount=current (starts 21-day window)
  // - New highlights added (count increased): reset firstShownAt=now to restart the 21-day window
  useEffect(() => {
    if (!countsLoaded || events.length === 0) return;
    const today = new Date();
    const now = Date.now();
    setHighlightsHeroData(prev => {
      let changed = false;
      const next = { ...prev };
      events.forEach((e: any) => {
        if (resolveCanonicalStage(e, today) !== 'HIGHLIGHTS') return;
        const currentCount = e.highlightsPhotoCount || 0;
        const entry = next[e.slug];
        if (!entry) {
          // First time seeing this event in HIGHLIGHTS — start the 21-day window
          next[e.slug] = { firstShownAt: now, lastSeenCount: currentCount };
          changed = true;
        } else if (currentCount > entry.lastSeenCount) {
          // New highlights published — reset the window to give full 21 more days
          next[e.slug] = { firstShownAt: now, lastSeenCount: currentCount };
          changed = true;
        }
      });
      if (changed) {
        AsyncStorage.setItem(HERO_STORAGE_KEYS.HIGHLIGHTS, JSON.stringify(next)).catch(() => {});
      }
      return changed ? next : prev;
    });
  }, [events, countsLoaded]);

  // When new events arrive: initialise heroSeenData entries for any event with matches
  // (sets firstSeenAt if this is the first time we see a non-zero matchedCount)
  useEffect(() => {
    if (!countsLoaded || events.length === 0) return;
    const now = Date.now();
    setHeroSeenData(prev => {
      let changed = false;
      const next = { ...prev };
      events.forEach((e: any) => {
        if ((e.matchedCount || 0) > 0 && !next[e.slug]) {
          // First ever detection of matches for this event — start the 7-day window
          next[e.slug] = { lastSeenCount: 0, firstSeenAt: now };
          changed = true;
        }
      });
      if (changed) {
        AsyncStorage.setItem(HERO_STORAGE_KEYS.FACE_MATCHES, JSON.stringify(next)).catch(() => {});
      }
      return changed ? next : prev;
    });
  }, [events, countsLoaded]);

  const handleHeroPress = (card: any) => {
    if (card.eventSlug) {
      // Mark current matchedCount as seen so hero only reappears on new photos
      const targetEvent = events.find((e: any) => e.slug === card.eventSlug);
      if (targetEvent && (targetEvent.matchedCount || 0) > 0) {
        setHeroSeenData(prev => {
          const next = {
            ...prev,
            [card.eventSlug]: {
              lastSeenCount: targetEvent.matchedCount,
              firstSeenAt: prev[card.eventSlug]?.firstSeenAt ?? Date.now(),
            },
          };
          AsyncStorage.setItem(HERO_STORAGE_KEYS.FACE_MATCHES, JSON.stringify(next)).catch(() => {});
          return next;
        });
      }
      const coverUrl = targetEvent?.coverPhotoMobileUrl || targetEvent?.coverPhotoUrl || null;
      const title = targetEvent?.title || null;
      setEventDetails(card.eventSlug, null, coverUrl, title);
      router.replace('/mycircle');
    }
  };

  const handleEventCardClick = (ev: any) => {
    const coverUrl = ev.coverPhotoMobileUrl || ev.coverPhotoUrl || null;
    setEventDetails(ev.slug, null, coverUrl, ev.title);
    router.replace('/mycircle');
  };

  // Dynamic Vibe filters from website story categories
  const vibeFilters = React.useMemo(() => {
    const categoriesSet = new Set<string>();
    const sourceStories = websiteStories;
    sourceStories.forEach((s: any) => {
      const cats = (s.category || '').split(',').map((c: string) => c.trim()).filter(Boolean);
      cats.forEach((c: string) => categoriesSet.add(c));
    });
    if (categoriesSet.size === 0) return ['All', 'Destination', 'Intimate', 'Luxury', 'Traditional'];
    return ['All', ...Array.from(categoriesSet).sort()];
  }, [websiteStories]);

  // Helper to filter website portfolio stories by selected Vibe
  const getFilteredVibeStories = () => {
    const sourceStories = websiteStories;

    if (selectedVibe === 'All') {
      return sourceStories;
    }

    return sourceStories.filter((s: any) => {
      const v = selectedVibe.toLowerCase();
      const dbCategories = (s.category || '').split(',').map((c: string) => c.trim().toLowerCase());
      if (dbCategories.includes(v)) return true;

      const title = (s.title || '').toLowerCase();
      const sub = (s.subtitle || '').toLowerCase();
      const loc = (s.location || '').toLowerCase();
      return title.includes(v) || sub.includes(v) || loc.includes(v);
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── 1. Hero Card (Minimalist Architectural — Editorial Copy) ── */}
        {singleHeroCard && (
          <Animated.View style={{ opacity: heroFadeAnim }}>
            <Pressable
              style={styles.heroSection}
              onPress={() => handleHeroPress(singleHeroCard)}
              disabled={!singleHeroCard.eventSlug || !singleHeroCard.cta}
            >
              <View style={styles.heroContentRow}>
                <View style={styles.heroGoldLine} />
                <View style={styles.heroTextContainer}>
                  <Text style={styles.greetingText}>{singleHeroCard.headline}</Text>
                  <Text style={styles.subtitleText}>{singleHeroCard.subtitle}</Text>
                  {singleHeroCard.cta ? (
                    <View style={styles.heroCtaButton}>
                      <Text style={styles.heroCtaText}>{singleHeroCard.cta}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          </Animated.View>
        )}

        {/* ── 2. My Circle (Only for users with joined celebrations) ── */}
        {token && events.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>MY CIRCLE</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              contentContainerStyle={styles.horizontalScroll}
              snapToInterval={width * 0.85 + 16}
              decelerationRate="fast"
            >
              {events.map((ev) => {
                const today = new Date();
                const statusMsg = getMyCircleStatusCopy(ev, today);
                const coverUrl = ev.coverPhotoMobileUrl || ev.coverPhotoUrl || null;
                const locationText = (ev.location || 'MISTY VISUALS').toUpperCase();

                return (
                  <Pressable 
                    key={ev.id} 
                    style={styles.myCircleCard}
                    onPress={() => handleEventCardClick(ev)}
                  >
                    {coverUrl ? (
                      <Image source={{ uri: coverUrl }} style={styles.myCircleCardImage} />
                    ) : (
                      <View style={styles.myCircleCardFallback}>
                        <Text style={{ fontSize: 32, color: '#a07850' }}>✨</Text>
                      </View>
                    )}
                    <LinearGradient 
                      colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.88)']} 
                      locations={[0, 0.45, 1]} 
                      style={styles.myCircleCardOverlay} 
                    />
                    <View style={styles.myCircleCardContent}>
                      <Text style={styles.myCircleCardLocation}>{locationText}</Text>
                      <Text style={styles.myCircleCardTitle}>{ev.title}</Text>
                      <Text style={styles.myCircleCardStatus}>{statusMsg}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── 3. My Likes (Conditional: ONLY rendered if user has liked photos) ── */}
        {likedPhotos.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>MY LIKES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {likedPhotos.map((photo, idx) => (
                <Pressable
                  key={photo.id || idx}
                  style={styles.likedCard}
                  onPress={() => {
                    // Open liked photo preview
                  }}
                >
                  <Image source={{ uri: photo.r2Url || photo.url }} style={styles.likedImage} />
                  <View style={styles.likedBadge}>
                    <Text style={styles.likedBadgeText}>❤️</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── 4. Featured Stories ─────────────────────────────────────────── */}
        {websiteStories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>FEATURED STORIES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {websiteStories
                .filter((s) => s.is_featured || websiteStories.every(item => !item.is_featured))
                .map((s) => ({
                  id: String(s.id),
                  slug: s.slug,
                  title: s.title,
                  subtitle: s.subtitle || s.category || 'Featured Story',
                  location: s.location || 'Misty Visuals',
                  date: s.date || '',
                  coverImage: (s.cover_image_mobile_url || s.cover_image_url || s.grid_image_url) 
                    ? { uri: s.cover_image_mobile_url || s.cover_image_url || s.grid_image_url }
                    : null,
                  description: s.subtitle || 'Unscripted moments and intentional design.',
                  images: []
                }))
                .map((story) => (
                  <Pressable 
                    key={story.id} 
                    style={styles.featuredCard}
                    onPress={() => handleStoryPress(story)}
                  >
                    {story.coverImage ? (
                      <Image source={story.coverImage} style={styles.featuredImage} />
                    ) : (
                      <View style={[styles.featuredImage, { backgroundColor: '#18181b' }]} />
                    )}
                    <LinearGradient 
                      colors={['transparent', 'rgba(18, 16, 14, 0.15)', 'rgba(18, 16, 14, 0.85)']} 
                      locations={[0, 0.45, 1]} 
                      style={styles.featuredOverlay} 
                    />
                    <View style={styles.featuredContent}>
                      <Text style={styles.featuredLocation}>{(story.location || 'MISTY VISUALS').toUpperCase()}</Text>
                      <Text style={styles.featuredTitle}>{story.title}</Text>
                      <Text style={styles.featuredReadMore}>View Collection →</Text>
                    </View>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        )}

        {/* ── 5. Featured Films (16:9 In-Place YouTube Playback) ───────────── */}
        {featuredFilmsOnly.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>FEATURED FILMS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {featuredFilmsOnly.map((film) => {
                const isPlaying = playingFilmId === String(film.id);
                const videoId = extractYouTubeId(film);
                const rawUrl = film.youtube_url || film.video_url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');

                const coverSrc =
                  typeof film.thumbnail_url === 'string'
                    ? { uri: film.thumbnail_url }
                    : film.thumbnail_url
                    ? film.thumbnail_url
                    : videoId
                    ? { uri: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` }
                    : null;

                const filmCardWidth = width * 0.84;
                const filmCardHeight = filmCardWidth * (9 / 16);

                return (
                  <View key={film.id} style={styles.filmCard}>
                    {isPlaying && videoId ? (
                      <View style={{ flex: 1, position: 'relative', backgroundColor: '#000000' }}>
                        <YoutubePlayer
                          height={filmCardHeight}
                          width={filmCardWidth}
                          videoId={videoId}
                          play={true}
                          forceAndroidAutoplay={true}
                          initialPlayerParams={{
                            controls: false,
                            modestbranding: true,
                            rel: false,
                            preventFullScreen: false,
                          }}
                          onChangeState={(state: string) => {
                            if (state === 'ended') setPlayingFilmId(null);
                          }}
                          webViewProps={{
                            allowsInlineMediaPlayback: true,
                            allowsFullscreenVideo: true,
                            mediaPlaybackRequiresUserAction: false,
                          }}
                        />
                        {rawUrl ? (
                          <Pressable
                            style={styles.openYouTubeBadge}
                            onPress={() => Linking.openURL(rawUrl).catch(() => {})}
                          >
                            <Text style={styles.openYouTubeBadgeText}>YouTube ↗</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : (
                      <Pressable
                        style={{ flex: 1, position: 'relative' }}
                        onPress={() => {
                          if (videoId) {
                            setPlayingFilmId(String(film.id));
                          } else if (rawUrl) {
                            Linking.openURL(rawUrl).catch(() => {});
                          }
                        }}
                      >
                        {coverSrc ? (
                          <Image source={coverSrc} style={styles.filmImage} />
                        ) : (
                          <View style={[styles.filmImage, { backgroundColor: '#18181b' }]} />
                        )}
                        <LinearGradient
                          colors={['transparent', 'rgba(18, 16, 14, 0.15)', 'rgba(18, 16, 14, 0.82)']}
                          locations={[0, 0.5, 1]}
                          style={styles.featuredOverlay}
                        />
                        
                        {/* Dead-Center Glassmorphic Play Button matching Website */}
                        <View style={styles.playCenterOverlay}>
                          <View style={styles.websitePlayCircle}>
                            <Text style={styles.websitePlayTriangle}>▶</Text>
                          </View>
                        </View>

                        <View style={styles.filmContent}>
                          <Text style={styles.filmTitle}>{film.title}</Text>
                          {film.location ? <Text style={styles.filmLocation}>📍 {film.location}</Text> : null}
                        </View>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── 6. Moodboards (Preview section with View All) ───────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeader}>MOODBOARDS</Text>
            <Pressable onPress={() => setIsMoodboardsOpen(true)}>
              <Text style={styles.viewAllText}>View All →</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
            {CURATED_MOODBOARDS.slice(0, 4).map((board) => (
              <Pressable
                key={board.id}
                style={styles.moodboardCard}
                onPress={() => {
                  setSelectedMoodboardId(board.id);
                  setIsMoodboardsOpen(true);
                }}
              >
                <Image source={board.coverImage} style={styles.moodboardImage} />
                <LinearGradient
                  colors={['transparent', 'rgba(18, 16, 14, 0.15)', 'rgba(18, 16, 14, 0.85)']}
                  locations={[0, 0.45, 1]}
                  style={styles.featuredOverlay}
                />
                <View style={styles.moodboardContent}>
                  <Text style={styles.moodboardTitle}>{board.title}</Text>
                  <Text style={styles.moodboardSub}>{board.subtitle}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* ── 7. Circle Journal ─────────────────────────────────────────────
             Hidden until real blog posts are available via API.
             To enable: fetch articles from your CMS/blog API and set websiteArticles state,
             then render them here exactly like Featured Stories.
        ────────────────────────────────────────────────────────────────────── */}

        {/* ── 8. Browse by Vibe (First 4 stories + Continue Exploring card) ─ */}
        {websiteStories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>BROWSE BY VIBE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vibePillScroll}>
              {vibeFilters.map((vibe) => (
                <Pressable 
                  key={vibe} 
                  style={[styles.vibePill, selectedVibe === vibe && styles.vibePillActive]}
                  onPress={() => setSelectedVibe(vibe)}
                >
                  <Text style={[styles.vibeText, selectedVibe === vibe && styles.vibeTextActive]}>{vibe}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Horizontal Story Stream (Max 4 stories + Continue Exploring card) */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {getFilteredVibeStories().length > 0 ? (
                <React.Fragment>
                  {getFilteredVibeStories().slice(0, 4).map((item: any, index: number) => {
                    const coverUri = item.cover_image_mobile_url || item.cover_image_url || item.grid_image_url;
                    const coverSrc = coverUri ? { uri: coverUri } : typeof item.img === 'string' ? { uri: item.img } : item.img || null;
                    
                    const titleText = item.title || '';
                    const subText = item.subtitle || item.location || '';

                    return (
                      <Pressable 
                        key={item.id || index} 
                        style={styles.vibeCardItem}
                        onPress={() => handleStoryPress(item)}
                      >
                        {coverSrc ? (
                          <Image source={coverSrc} style={styles.vibeCardImage} />
                        ) : (
                          <View style={[styles.vibeCardImage, { backgroundColor: '#18181b' }]} />
                        )}
                        <LinearGradient 
                          colors={['transparent', 'rgba(18, 16, 14, 0.15)', 'rgba(18, 16, 14, 0.85)']} 
                          locations={[0, 0.45, 1]} 
                          style={styles.featuredOverlay} 
                        />
                        <View style={styles.vibeCardContent}>
                          <Text style={styles.vibeCardTitle} numberOfLines={1}>{titleText}</Text>
                          <Text style={styles.vibeCardSubtext} numberOfLines={1}>{subText}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  {getFilteredVibeStories().length > 4 && (
                    <Pressable
                      style={styles.continueExploringCard}
                      onPress={() => setIsAllStoriesOpen(true)}
                    >
                      <Text style={styles.continueExploringIcon}>✨</Text>
                      <Text style={styles.continueExploringTitle}>Continue Exploring</Text>
                      <Text style={styles.continueExploringSub}>
                        +{getFilteredVibeStories().length - 4} more stories in {selectedVibe}
                      </Text>
                      <Text style={styles.continueExploringCta}>View All Stories →</Text>
                    </Pressable>
                  )}
                </React.Fragment>
              ) : (
                <View style={styles.emptyVibeContainer}>
                  <Text style={styles.emptyVibeText}>No stories found under "{selectedVibe}".</Text>
                </View>
              )}
            </ScrollView>
          </View>
        )}

        {/* ── 9. Join Celebration CTA (Closing Section at the Bottom) ─────── */}
        <View style={styles.joinCtaSection}>
          <View style={styles.joinCtaDivider} />
          <Text style={styles.joinCtaHeader}>
            {events.length === 0 ? 'Ready to relive a celebration?' : 'Join Another Celebration'}
          </Text>
          <Text style={styles.joinCtaSubline}>
            {events.length === 0
              ? 'Join using your invitation code to unlock your private memories and AI face-matched photos.'
              : 'Enter your invitation code or scan a QR code to unlock more private memories.'}
          </Text>
          <Pressable style={styles.joinCtaBtn} onPress={() => router.replace('/mycircle')}>
            <Text style={styles.joinCtaBtnText}>JOIN CELEBRATION →</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Modals */}
      <FeaturedStoryView
        isOpen={selectedStory !== null}
        onClose={() => setSelectedStory(null)}
        story={selectedStory}
      />

      <ArticleView
        isOpen={selectedArticle !== null}
        onClose={() => setSelectedArticle(null)}
        article={selectedArticle}
      />

      <MoodboardsView
        isOpen={isMoodboardsOpen}
        onClose={() => setIsMoodboardsOpen(false)}
        selectedBoardId={selectedMoodboardId}
      />

      <AllStoriesView
        isOpen={isAllStoriesOpen}
        onClose={() => setIsAllStoriesOpen(false)}
        stories={websiteStories}
        initialVibe={selectedVibe}
        onSelectStory={(story) => handleStoryPress(story)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    paddingBottom: 100, // Space for bottom custom navigation tab
  },
  heroSection: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    backgroundColor: 'transparent',
  },
  heroContentRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  heroGoldLine: {
    width: 2.5,
    backgroundColor: '#C5A059',
    borderRadius: 2,
    marginRight: 16,
  },
  heroTextContainer: {
    flex: 1,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  greetingText: {
    fontFamily: 'serif',
    fontSize: 26,
    fontWeight: '500',
    color: '#1c1917',
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  heroBadgeInline: {
    backgroundColor: 'rgba(197, 160, 89, 0.22)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
    marginLeft: 10,
    marginTop: 6,
  },
  heroBadge: {
    backgroundColor: 'rgba(197, 160, 89, 0.22)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  heroBadgeText: {
    fontFamily: 'System',
    fontSize: 9.5,
    fontWeight: '700',
    color: '#8C6721',
    letterSpacing: 1.5,
  },
  subtitleText: {
    fontFamily: 'System',
    fontSize: 15,
    lineHeight: 22,
    color: '#403d39',
    marginTop: 6,
  },
  heroCtaButton: {
    marginTop: 18,
    backgroundColor: '#1c1917',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  heroCtaText: {
    fontFamily: 'System',
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  section: {
    paddingTop: 32,
  },
  sectionHeader: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#8c867e',
    marginHorizontal: 24,
    marginBottom: 16,
  },
  horizontalScroll: {
    paddingLeft: 24,
    paddingRight: 12,
  },
  eventCard: {
    width: 200,
    marginRight: 16,
    borderWidth: 1,
    borderColor: '#f0ede8',
    backgroundColor: '#ffffff',
  },
  cardImageContainer: {
    width: '100%',
    height: 120,
    backgroundColor: '#f5f5f5',
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardImageFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 2,
  },
  badgeText: {
    fontFamily: 'System',
    fontSize: 8,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 1,
  },
  cardInfo: {
    padding: 12,
  },
  cardTitle: {
    fontFamily: 'System',
    fontSize: 12,
    fontWeight: '700',
    color: '#1c1a18',
    marginBottom: 4,
  },
  cardSubtext: {
    fontFamily: 'System',
    fontSize: 10,
    color: '#8c867e',
  },
  myCircleCard: {
    width: width * 0.85,
    aspectRatio: 3 / 2,
    marginRight: 16,
    backgroundColor: '#1c1a18',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 4,
  },
  myCircleCardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  myCircleCardFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1c1a18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  myCircleCardOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  myCircleCardContent: {
    position: 'absolute',
    bottom: 18,
    left: 18,
    right: 18,
  },
  myCircleCardLocation: {
    fontFamily: 'System',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#d0c8be',
    marginBottom: 4,
    opacity: 0.85,
  },
  myCircleCardTitle: {
    fontFamily: 'serif',
    fontSize: 20,
    fontWeight: '300',
    color: '#ffffff',
    marginBottom: 4,
    lineHeight: 25,
  },
  myCircleCardStatus: {
    fontFamily: 'System',
    fontSize: 11,
    color: '#e5dfd5',
    letterSpacing: 0.3,
  },
  featuredCard: {
    width: width * 0.7,
    height: 360,
    marginRight: 16,
    backgroundColor: '#1c1a18',
    position: 'relative',
    overflow: 'hidden',
  },
  featuredImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  featuredOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  featuredContent: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
  },
  featuredLocation: {
    fontFamily: 'System',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#ffffff',
    marginBottom: 6,
    opacity: 0.8,
  },
  featuredTitle: {
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '300',
    color: '#ffffff',
    marginBottom: 12,
  },
  featuredReadMore: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    color: '#ffffff',
    opacity: 0.9,
  },
  articlesContainer: {
    paddingHorizontal: 24,
    gap: 16,
  },
  articleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
  },
  articleImage: {
    width: 80,
    height: 80,
    backgroundColor: '#f5f5f5',
    resizeMode: 'cover',
  },
  articleInfo: {
    flex: 1,
    paddingLeft: 16,
  },
  articleCategory: {
    fontFamily: 'System',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#8c867e',
    marginBottom: 6,
  },
  articleTitle: {
    fontFamily: 'serif',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 18,
    color: '#1c1a18',
    marginBottom: 6,
  },
  articleMeta: {
    fontFamily: 'System',
    fontSize: 10,
    color: '#8c867e',
  },
  vibePillScroll: {
    paddingLeft: 24,
    paddingRight: 12,
    marginBottom: 16,
  },
  vibePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd8d0',
    marginRight: 8,
    backgroundColor: '#ffffff',
  },
  vibePillActive: {
    backgroundColor: '#1c1a18',
    borderColor: '#1c1a18',
  },
  vibeText: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '600',
    color: '#8c867e',
    letterSpacing: 1,
  },
  vibeTextActive: {
    color: '#ffffff',
  },
  vibeGalleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  vibeGalleryItem: {
    width: '48%',
    marginBottom: 12,
  },
  vibeGalleryImage: {
    width: '100%',
    height: 140,
    backgroundColor: '#f5f5f5',
    resizeMode: 'cover',
  },
  vibeGalleryLabel: {
    fontFamily: 'serif',
    fontSize: 12,
    fontWeight: '600',
    color: '#1c1a18',
    marginTop: 6,
    textAlign: 'center',
  },
  vibeGallerySublabel: {
    fontFamily: 'System',
    fontSize: 9,
    fontWeight: '500',
    color: '#8c867e',
    marginTop: 2,
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  emptyVibeContainer: {
    width: '100%',
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyVibeText: {
    fontFamily: 'serif',
    fontSize: 12,
    fontStyle: 'italic',
    color: '#8c867e',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 24,
    marginBottom: 16,
  },
  viewAllText: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.5,
    color: '#a07850',
  },
  likedCard: {
    width: 130,
    height: 170,
    marginRight: 14,
    position: 'relative',
    backgroundColor: '#f9fafb',
    borderRadius: 2,
    overflow: 'hidden',
  },
  likedImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  likedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(28, 26, 24, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  likedBadgeText: {
    fontSize: 11,
  },
  filmCard: {
    width: width * 0.84,
    aspectRatio: 16 / 9,
    marginRight: 16,
    backgroundColor: '#000000',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 2,
  },
  openYouTubeBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(28, 26, 24, 0.85)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    zIndex: 10,
  },
  openYouTubeBadgeText: {
    fontFamily: 'System',
    fontSize: 9,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  filmImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  playCenterOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  websitePlayCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  websitePlayTriangle: {
    color: '#ffffff',
    fontSize: 16,
    paddingLeft: 3,
  },
  filmContent: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
  filmCategory: {
    fontFamily: 'System',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#a07850',
    marginBottom: 4,
  },
  filmTitle: {
    fontFamily: 'serif',
    fontSize: 18,
    fontWeight: '300',
    color: '#ffffff',
    marginBottom: 4,
  },
  filmLocation: {
    fontFamily: 'System',
    fontSize: 10,
    color: '#d0c8be',
  },
  moodboardCard: {
    width: width * 0.6,
    height: 180,
    marginRight: 16,
    backgroundColor: '#1c1a18',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 2,
  },
  moodboardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  moodboardContent: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
  moodboardTitle: {
    fontFamily: 'serif',
    fontSize: 20,
    fontWeight: '300',
    color: '#ffffff',
    marginBottom: 4,
  },
  moodboardSub: {
    fontFamily: 'System',
    fontSize: 10,
    color: '#d0c8be',
    letterSpacing: 0.5,
  },
  vibeCardItem: {
    width: 170,
    height: 230,
    marginRight: 14,
    backgroundColor: '#1c1a18',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 2,
  },
  vibeCardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  vibeCardContent: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
  },
  vibeCardTitle: {
    fontFamily: 'serif',
    fontSize: 16,
    fontWeight: '300',
    color: '#ffffff',
    marginBottom: 2,
  },
  vibeCardSubtext: {
    fontFamily: 'System',
    fontSize: 9,
    color: '#d0c8be',
    letterSpacing: 0.5,
  },
  continueExploringCard: {
    width: 170,
    height: 230,
    marginRight: 16,
    backgroundColor: '#fbfaf8',
    borderWidth: 1,
    borderColor: '#e5e0d8',
    borderRadius: 2,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueExploringIcon: {
    fontSize: 24,
    marginBottom: 10,
  },
  continueExploringTitle: {
    fontFamily: 'System',
    fontSize: 13,
    fontWeight: '700',
    color: '#1c1a18',
    textAlign: 'center',
    marginBottom: 6,
  },
  continueExploringSub: {
    fontFamily: 'serif',
    fontSize: 11,
    color: '#8c867e',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 15,
  },
  continueExploringCta: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#a07850',
  },
  joinCtaSection: {
    marginHorizontal: 24,
    marginTop: 48,
    marginBottom: 20,
    paddingVertical: 36,
    paddingHorizontal: 24,
    backgroundColor: '#fbfaf8',
    borderWidth: 1,
    borderColor: '#f0ede8',
    alignItems: 'center',
  },
  joinCtaDivider: {
    width: 40,
    height: 1,
    backgroundColor: '#a07850',
    marginBottom: 20,
  },
  joinCtaHeader: {
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '300',
    color: '#1c1a18',
    textAlign: 'center',
    marginBottom: 10,
  },
  joinCtaSubline: {
    fontFamily: 'System',
    fontSize: 12,
    color: '#60646c',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
    marginBottom: 24,
  },
  joinCtaBtn: {
    backgroundColor: '#1c1a18',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 2,
  },
  joinCtaBtnText: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#ffffff',
  },
});
