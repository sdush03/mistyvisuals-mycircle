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

// Sub-components for reading/exploring
import FeaturedStoryView from '../components/home/FeaturedStoryView';
import ArticleView from '../components/home/ArticleView';

const { width } = Dimensions.get('window');

// Local Data Definitions for the Editorial Showcase
const FEATURED_STORIES = [
  {
    id: 'story_1',
    title: 'Wildflower Vows',
    subtitle: 'A Golden Hour Forest Union',
    location: 'Himalayan Forest',
    date: 'October 2023',
    coverImage: require('@/assets/images/portfolio/sunset_couple.jpg'),
    description: 'Set against the rugged peaks of the Himalayas, Kabir and Aisha celebrated their love surrounded by towering pines and wildflowers. Under the soft glow of a setting sun, they exchanged vows in an intimate, emotional ceremony that felt suspended in time.',
    images: [
      require('@/assets/images/portfolio/sunset_couple.jpg'),
      require('@/assets/images/portfolio/indian_bride.jpg'),
      require('@/assets/images/portfolio/palace_wedding.jpg'),
    ]
  },
  {
    id: 'story_2',
    title: 'Laughter & Lights',
    subtitle: 'A Traditional Modern Wedding',
    location: 'Delhi, India',
    date: 'December 2023',
    coverImage: require('@/assets/images/portfolio/indian_bride.jpg'),
    description: "Riya and Aman's wedding was a beautiful dance of century-old traditions and modern vibrancy. From the bright marigolds of the haldi to the emotional pheras, every single second was illuminated by authentic joy, radiant smiles, and a deep love that warmed the entire room.",
    images: [
      require('@/assets/images/portfolio/indian_bride.jpg'),
      require('@/assets/images/portfolio/sunset_couple.jpg'),
      require('@/assets/images/portfolio/palace_wedding.jpg'),
    ]
  },
  {
    id: 'story_3',
    title: 'Lakefront Royalty',
    subtitle: 'A Royal Destination Affair',
    location: 'Udaipur, India',
    date: 'November 2023',
    coverImage: require('@/assets/images/portfolio/palace_wedding.jpg'),
    description: "Set on the majestic shores of Lake Pichola, Meera and Vikram's Udaipur wedding was a visual masterpiece. With Rajput architecture reflecting in the calm waters and royal grandeur echoing in every corridor, the celebration was nothing short of a cinematic fairy tale.",
    images: [
      require('@/assets/images/portfolio/palace_wedding.jpg'),
      require('@/assets/images/portfolio/indian_bride.jpg'),
      require('@/assets/images/portfolio/sunset_couple.jpg'),
    ]
  }
];

const ARTICLES = [
  {
    id: 'article_1',
    title: "How to survive your best friend's wedding 😂",
    category: 'Lifestyle',
    date: 'Nov 12, 2023',
    readTime: '4 min read',
    coverImage: require('@/assets/images/portfolio/sunset_couple.jpg'),
    content: [
      "So, your best friend is getting married. Congratulations! You've officially been promoted from partner-in-crime to full-time wedding emotional support coordinator, emergency safety pin holder, and chief dance floor instigator.",
      "While it is one of the most beautiful moments of your life to see them find 'the one', it is also a marathon of events. Between the sangeet practice, holding the heavy lehenga, making sure the groom's shoes don't actually get stolen, and delivering a toast that is emotional but not too embarrassing, it's easy to get overwhelmed.",
      "Our number one tip: Keep a small survival kit in your pocket. Mints, safety pins, wet wipes, and double-sided tape are worth their weight in gold. And most importantly, remember to step back and look at your friend during the ceremony. The chaos fades, but the memory of seeing them happy will last forever."
    ]
  },
  {
    id: 'article_2',
    title: 'Why Indian weddings are becoming more intimate',
    category: 'Trends',
    date: 'Dec 05, 2023',
    readTime: '6 min read',
    coverImage: require('@/assets/images/portfolio/palace_wedding.jpg'),
    content: [
      "For decades, the standard Indian wedding was defined by its guest list—often running into the thousands. But in recent years, a quiet revolution has been taking place. More and more couples are opting to scale down their celebrations, focusing instead on intimate, highly personalized weddings.",
      "An intimate wedding (typically under 150 guests) changes the entire energy of the day. Instead of spending hours standing on a stage greeting hundreds of distant relatives, couples are actually sitting down, sharing meals, and dancing alongside their closest friends and family.",
      "From a photography perspective, intimate weddings are a dream. We get to capture real, unposed interactions. The emotions are raw, the atmosphere is relaxed, and the couple gets to truly live their wedding day instead of just hosting it."
    ]
  },
  {
    id: 'article_3',
    title: 'The story behind this royal Udaipur balcony shot',
    category: 'Behind the Lens',
    date: 'Oct 28, 2023',
    readTime: '3 min read',
    coverImage: require('@/assets/images/portfolio/palace_wedding.jpg'),
    content: [
      "Behind every iconic photograph is a story of planning, timing, and sometimes a little bit of magic. This particular image, captured on the balcony of a heritage palace in Udaipur, was months in the making.",
      "The challenge with grand heritage properties is that they are popular. Finding a moment where the light is perfect, the wind is calm, and there are no other people in the frame is incredibly difficult. We had a window of exactly seven minutes during golden hour.",
      "We positioned the couple just as the sun dipped behind the Aravali hills. The golden reflection on Lake Pichola created a natural studio light, highlighting the intricate gold embroidery of their traditional attire. It stands as one of our favorite examples of fine-art editorial framing."
    ]
  }
];

const VIBES = ['All', 'Luxury', 'Destination', 'Intimate', 'Traditional'];

export default function HomeScreen() {
  const { token, profile, setEventDetails } = useAuthStore();
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedVibe, setSelectedVibe] = useState('All');

  // Modals for full articles / portfolios
  const [selectedStory, setSelectedStory] = useState<any | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<any | null>(null);

  const [websiteStories, setWebsiteStories] = useState<any[]>([]);

  // Stored matched counts for detecting new photos
  const [lastMatchedCounts, setLastMatchedCounts] = useState<Record<string, number>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);

  // Fetch featured stories from website API
  useEffect(() => {
    const fetchWebsiteStories = async () => {
      try {
        const res = await fetch('https://www.mistyvisuals.com/api/website/stories');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setWebsiteStories(data);
          }
        }
      } catch (e) {
        console.warn('Failed to fetch website stories:', e);
      }
    };
    fetchWebsiteStories();
  }, []);

  // Load previously stored matchedCounts from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem('@mycircle_matched_counts')
      .then(stored => {
        if (stored) setLastMatchedCounts(JSON.parse(stored));
      })
      .catch(() => {})
      .finally(() => setCountsLoaded(true));
  }, []);

  // Fetch joined wedding events if authenticated
  useEffect(() => {
    const fetchUserEvents = async () => {
      if (!token) {
        setEvents([]);
        return;
      }
      try {
        setLoadingEvents(true);
        const res = await api.get('/api/gallery/family/events');
        setEvents(res.data.events || []);
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
            coverImage: coverUri ? { uri: coverUri } : require('@/assets/images/portfolio/sunset_couple.jpg'),
            description: fullStory.subtitle || 'Unscripted moments and intentional design.',
            images: galleryImages.length > 0 ? galleryImages : (coverUri ? [{ uri: coverUri }] : [require('@/assets/images/portfolio/sunset_couple.jpg')]),
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

  // ─── Scalable Hero Priority Engine ──────────────────────────────────────────
  const singleHeroCard = React.useMemo(() => {
    const today = new Date();
    const params = {
      events,
      lastMatchedCounts,
      profileName: profile?.name,
      today,
    };

    // Scalable Priority Registry (evaluated top-down in array order)
    const HERO_PRIORITY_EVALUATORS = [
      // 1. NEW_MATCHES
      ({ events: evts, lastMatchedCounts: counts }: any) => {
        for (const ev of evts) {
          const currentCount = ev.matchedCount || 0;
          const prevCount = counts[ev.slug] ?? null;
          if (prevCount !== null && currentCount > prevCount) {
            const diff = currentCount - prevCount;
            return {
              type: 'NEW_MATCHES',
              icon: '✨',
              headline: `We found ${diff} new memo${diff === 1 ? 'ry' : 'ries'} of you.`,
              subtitle: `${ev.title} · Your gallery has been updated`,
              cta: 'View Gallery →',
              eventSlug: ev.slug,
            };
          }
        }
        return null;
      },

      // 2. NEW_HIGHLIGHTS
      ({ events: evts, today: now }: any) => {
        for (const ev of evts) {
          const stage = resolveCanonicalStage(ev, now);
          if (stage === 'HIGHLIGHTS') {
            return {
              type: 'NEW_HIGHLIGHTS',
              icon: '✨',
              headline: `Highlights from ${ev.title} are now available.`,
              subtitle: 'View curated highlights & top moments',
              cta: 'View Highlights →',
              eventSlug: ev.slug,
            };
          }
        }
        return null;
      },

      // 3. ANNIVERSARY
      ({ events: evts, today: now }: any) => {
        for (const ev of evts) {
          const eventDate = new Date(ev.date);
          if (eventDate < now && !isSameDay(eventDate, now)) {
            const weddingYear = eventDate.getFullYear();
            const weddingMonth = eventDate.getMonth();
            const weddingDay = eventDate.getDate();

            if (weddingYear < now.getFullYear()) {
              let nextAnniv = new Date(now.getFullYear(), weddingMonth, weddingDay);
              if (nextAnniv < now && !isSameDay(nextAnniv, now)) {
                nextAnniv = new Date(now.getFullYear() + 1, weddingMonth, weddingDay);
              }

              const isAnnivToday = isSameDay(nextAnniv, now);
              const daysUntil = Math.ceil((nextAnniv.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

              if (isAnnivToday) {
                return {
                  type: 'ANNIVERSARY',
                  icon: '❤️',
                  headline: 'One year ago today...',
                  subtitle: `Relive ${ev.title}'s celebration`,
                  cta: 'Relive Gallery →',
                  eventSlug: ev.slug,
                };
              } else if (daysUntil <= 14 && daysUntil > 0) {
                return {
                  type: 'ANNIVERSARY',
                  icon: '❤️',
                  headline: `${ev.title}'s anniversary in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
                  subtitle: `Relive ${ev.title}'s celebration`,
                  cta: 'Relive Gallery →',
                  eventSlug: ev.slug,
                };
              }
            }
          }
        }
        return null;
      },

      // 4. UPCOMING
      ({ events: evts, today: now }: any) => {
        for (const ev of evts) {
          const stage = resolveCanonicalStage(ev, now);
          if (stage === 'UPCOMING') {
            const eventDate = new Date(ev.date);
            const days = Math.ceil((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            return {
              type: 'UPCOMING',
              icon: '📅',
              headline: `${ev.title} celebrate in ${days} day${days === 1 ? '' : 's'}.`,
              subtitle: 'See venue, schedule & updates',
              cta: 'View Event →',
              eventSlug: ev.slug,
            };
          }
        }
        return null;
      },

      // 5. LIVE
      ({ events: evts, today: now }: any) => {
        for (const ev of evts) {
          const stage = resolveCanonicalStage(ev, now);
          if (stage === 'LIVE') {
            return {
              type: 'LIVE',
              icon: '🎉',
              headline: `Today is ${ev.title}'s wedding day!`,
              subtitle: 'Celebration is live · Access updates & shared photos',
              cta: 'Open Celebration →',
              eventSlug: ev.slug,
            };
          }
        }
        return null;
      },

      // 6. WELCOME (Fallback)
      ({ profileName, today: now }: any) => {
        const firstName = profileName ? profileName.split(' ')[0] : '';
        const hrs = now.getHours();
        const greet = hrs < 12 ? 'Good Morning' : hrs < 17 ? 'Good Afternoon' : 'Good Evening';
        return {
          type: 'WELCOME',
          icon: '👋',
          headline: firstName ? `Welcome back, ${firstName}` : 'Welcome to My Circle',
          subtitle: 'Every celebration. Every memory. One place.',
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
  }, [events, lastMatchedCounts, profile?.name]);

  // Persist matched counts once events load
  useEffect(() => {
    if (!countsLoaded) return;
    if (events.length > 0) {
      const newCounts: Record<string, number> = {};
      events.forEach((e) => { newCounts[e.slug] = e.matchedCount || 0; });
      AsyncStorage.setItem('@mycircle_matched_counts', JSON.stringify(newCounts)).catch(() => {});
    }
  }, [events, countsLoaded]);

  const handleHeroPress = (card: any) => {
    if (card.eventSlug) {
      setEventDetails(card.eventSlug, null);
      router.replace('/mycircle');
    }
  };

  const handleEventCardClick = (ev: any) => {
    // If it's a ready event, go directly to the gallery inside mycircle tab
    setEventDetails(ev.slug, null);
    router.replace('/mycircle');
  };

  // Dynamic Vibe filters from website story categories
  const vibeFilters = React.useMemo(() => {
    const categoriesSet = new Set<string>();
    const sourceStories = websiteStories.length > 0 ? websiteStories : FEATURED_STORIES;
    sourceStories.forEach((s: any) => {
      const cats = (s.category || '').split(',').map((c: string) => c.trim()).filter(Boolean);
      cats.forEach((c: string) => categoriesSet.add(c));
    });
    if (categoriesSet.size === 0) return ['All', 'Destination', 'Intimate', 'Luxury', 'Traditional'];
    return ['All', ...Array.from(categoriesSet).sort()];
  }, [websiteStories]);

  // Helper to filter website portfolio stories by selected Vibe
  const getFilteredVibeStories = () => {
    const sourceStories = websiteStories.length > 0 ? websiteStories : FEATURED_STORIES;

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
        {/* ── 1. Single Intelligent Hero Card ─────────────────────────────── */}
        {singleHeroCard && (
          <Pressable
            style={styles.heroSection}
            onPress={() => handleHeroPress(singleHeroCard)}
            disabled={!singleHeroCard.eventSlug}
          >
            <View style={styles.heroCardContentContainer}>
              <Text style={styles.heroIcon}>{singleHeroCard.icon}</Text>
              <Text style={styles.greetingText}>{singleHeroCard.headline}</Text>
              <Text style={styles.subtitleText}>{singleHeroCard.subtitle}</Text>
              {singleHeroCard.cta ? (
                <Text style={styles.heroCta}>{singleHeroCard.cta}</Text>
              ) : null}
            </View>
          </Pressable>
        )}

        {/* ── 2. What's Happening (Only for users with joined celebrations) ── */}
        {token && events.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>WHAT'S HAPPENING</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {events.map((ev) => {
                const today = new Date();
                const eventDate = new Date(ev.date);
                const stage = resolveCanonicalStage(ev, today);

                let badgeColor = '#60646c';
                let statusMsg = `${ev.matchedCount || 0} photo${ev.matchedCount === 1 ? '' : 's'} matched`;

                if (stage === 'UPCOMING') {
                  const days = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  badgeColor = '#8c867e';
                  statusMsg = `Wedding in ${days} day${days === 1 ? '' : 's'}`;
                } else if (stage === 'LIVE') {
                  badgeColor = '#a07850';
                  statusMsg = 'Happening today! 🎊';
                } else if (stage === 'HIGHLIGHTS') {
                  badgeColor = '#a07850';
                  statusMsg = 'Curated highlights ready';
                } else {
                  // READY
                  badgeColor = '#60646c';
                  statusMsg = `${ev.matchedCount || 0} photo${ev.matchedCount === 1 ? '' : 's'} matched`;
                }

                return (
                  <Pressable 
                    key={ev.id} 
                    style={styles.eventCard}
                    onPress={() => handleEventCardClick(ev)}
                  >
                    <View style={styles.cardImageContainer}>
                      {ev.coverPhotoUrl ? (
                        <Image source={{ uri: ev.coverPhotoUrl }} style={styles.cardImage} />
                      ) : (
                        <View style={styles.cardImageFallback}>
                          <Text style={{ fontSize: 24 }}>✨</Text>
                        </View>
                      )}
                      <View style={[styles.badge, { backgroundColor: badgeColor }]}>
                        <Text style={styles.badgeText}>{stage}</Text>
                      </View>
                    </View>
                    <View style={styles.cardInfo}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{ev.title}</Text>
                      <Text style={styles.cardSubtext}>{statusMsg}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Layer 3: "Featured by Misty Visuals" (Netflix Carousel) */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>FEATURED BY MISTY VISUALS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
            {(websiteStories.length > 0
              ? websiteStories
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
                      : require('@/assets/images/portfolio/sunset_couple.jpg'),
                    description: s.subtitle || 'Unscripted moments and intentional design.',
                    images: []
                  }))
              : FEATURED_STORIES
            ).map((story) => (
              <Pressable 
                key={story.id} 
                style={styles.featuredCard}
                onPress={() => handleStoryPress(story)}
              >
                <Image source={story.coverImage} style={styles.featuredImage} />
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

        {/* Layer 4: "Circle Stories" (Editorial Journal) */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>CIRCLE JOURNAL</Text>
          <View style={styles.articlesContainer}>
            {ARTICLES.map((article) => (
              <Pressable 
                key={article.id} 
                style={styles.articleCard}
                onPress={() => setSelectedArticle(article)}
              >
                <Image source={article.coverImage} style={styles.articleImage} />
                <View style={styles.articleInfo}>
                  <Text style={styles.articleCategory}>{article.category.toUpperCase()}</Text>
                  <Text style={styles.articleTitle} numberOfLines={2}>{article.title}</Text>
                  <Text style={styles.articleMeta}>{article.date} • {article.readTime}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Layer 5: "Browse by Vibe" (Interactive pills) */}
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

          {/* Vibe mini gallery */}
          <View style={styles.vibeGalleryGrid}>
            {getFilteredVibeStories().length > 0 ? (
              getFilteredVibeStories().map((item: any, index: number) => {
                const coverSrc = item.img
                  ? item.img
                  : item.cover_image_mobile_url || item.cover_image_url || item.grid_image_url
                  ? { uri: item.cover_image_mobile_url || item.cover_image_url || item.grid_image_url }
                  : require('@/assets/images/portfolio/sunset_couple.jpg');
                
                const titleText = item.title || '';
                const subText = item.subtitle || item.location || '';

                return (
                  <Pressable 
                    key={item.id || index} 
                    style={styles.vibeGalleryItem}
                    onPress={() => handleStoryPress(item)}
                  >
                    <Image source={coverSrc} style={styles.vibeGalleryImage} />
                    {titleText ? (
                      <Text style={styles.vibeGalleryLabel} numberOfLines={1}>
                        {titleText}
                      </Text>
                    ) : null}
                    {subText ? (
                      <Text style={styles.vibeGallerySublabel} numberOfLines={1}>
                        {subText}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })
            ) : (
              <View style={styles.emptyVibeContainer}>
                <Text style={styles.emptyVibeText}>No stories found under "{selectedVibe}".</Text>
              </View>
            )}
          </View>
        </View>

        {/* CTA: Join Celebration */}
        <View style={styles.ctaCard}>
          <Text style={styles.ctaTitle}>Attending a Wedding?</Text>
          <Text style={styles.ctaSubtitle}>
            Unlock private galleries, view shared memories, and find photos of yourself automatically.
          </Text>
          <Pressable 
            style={styles.ctaButton}
            onPress={() => router.replace('/mycircle')}
          >
            <Text style={styles.ctaButtonText}>🔑 JOIN A CELEBRATION</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Full screen Modals for viewing story details & articles */}
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
    paddingBottom: 26,
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
    backgroundColor: '#fbfaf8',
  },
  heroCardContentContainer: {
    width: '100%',
  },
  heroIcon: {
    fontSize: 26,
    marginBottom: 8,
  },
  greetingText: {
    fontFamily: 'System',
    fontSize: 22,
    fontWeight: '700',
    color: '#1c1a18',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subtitleText: {
    fontFamily: 'serif',
    fontSize: 13,
    lineHeight: 20,
    color: '#60646c',
  },
  heroCta: {
    marginTop: 12,
    fontFamily: 'System',
    fontSize: 12,
    fontWeight: '600',
    color: '#a07850',
    letterSpacing: 0.4,
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
  ctaCard: {
    marginHorizontal: 24,
    marginTop: 40,
    padding: 24,
    backgroundColor: '#1c1a18',
    alignItems: 'center',
  },
  ctaTitle: {
    fontFamily: 'System',
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
    letterSpacing: 1,
  },
  ctaSubtitle: {
    fontFamily: 'serif',
    fontSize: 12,
    color: '#b5b0aa',
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  ctaButton: {
    width: '100%',
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonText: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '700',
    color: '#1c1a18',
    letterSpacing: 2,
  },
});
