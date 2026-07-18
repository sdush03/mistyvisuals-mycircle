import React, { useEffect, useState } from 'react';
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
  StatusBar 
} from 'react-native';
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

const VIBES = ['Luxury', 'Destination', 'Intimate', 'Traditional', 'Beach', 'Mountain'];

export default function HomeScreen() {
  const { token, profile, setEventDetails } = useAuthStore();
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedVibe, setSelectedVibe] = useState('Luxury');

  // Modals for full articles / portfolios
  const [selectedStory, setSelectedStory] = useState<any | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<any | null>(null);

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

  // Determine the dynamic header greeting
  const getGreetingHeader = () => {
    if (!profile || !profile.name) {
      return {
        greeting: 'Welcome to My Circle',
        subtitle: 'Every celebration. Every memory. One place.'
      };
    }

    const hrs = new Date().getHours();
    let greet = 'Good Morning';
    if (hrs >= 12 && hrs < 17) greet = 'Good Afternoon';
    else if (hrs >= 17 || hrs < 4) greet = 'Good Evening';

    // Figure out priority message
    let subtitle = 'Explore recent memories and upcoming celebrations.';
    if (events.length > 0) {
      const upcoming = events.find(e => new Date(e.date) > new Date());
      const processing = events.find(e => new Date(e.date) <= new Date() && !e.galleryFacesComplete);
      const matched = events.reduce((sum, e) => sum + (e.matchedCount || 0), 0);

      if (upcoming) {
        const days = Math.ceil((new Date(upcoming.date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        subtitle = `Your next celebration is in ${days} days.`;
      } else if (processing) {
        subtitle = `Photos from ${processing.title} are being curated.`;
      } else if (matched > 0) {
        subtitle = `We found ${matched} matched photos of you!`;
      }
    }

    return {
      greeting: `${greet}, ${profile.name.split(' ')[0]} 👋`,
      subtitle
    };
  };

  const headerInfo = getGreetingHeader();

  const handleEventCardClick = (ev: any) => {
    // If it's a ready event, go directly to the gallery inside mycircle tab
    setEventDetails(ev.slug, null);
    router.replace('/mycircle');
  };

  // Helper to filter showcase items by selected Vibe
  const getFilteredVibeImages = () => {
    // Simulating vibe photo grid by repeating our loaded pictures
    switch (selectedVibe) {
      case 'Luxury':
        return [
          { img: require('@/assets/images/portfolio/palace_wedding.jpg'), title: 'Udaipur' },
          { img: require('@/assets/images/portfolio/indian_bride.jpg'), title: 'Royal Lehenga' }
        ];
      case 'Destination':
        return [
          { img: require('@/assets/images/portfolio/sunset_couple.jpg'), title: 'Hillside Embrace' },
          { img: require('@/assets/images/portfolio/palace_wedding.jpg'), title: 'Lake Balcony' }
        ];
      case 'Intimate':
        return [
          { img: require('@/assets/images/portfolio/sunset_couple.jpg'), title: 'Golden Vows' }
        ];
      case 'Traditional':
        return [
          { img: require('@/assets/images/portfolio/indian_bride.jpg'), title: 'Pheras' }
        ];
      default:
        return [
          { img: require('@/assets/images/portfolio/sunset_couple.jpg'), title: 'Couple' },
          { img: require('@/assets/images/portfolio/palace_wedding.jpg'), title: 'Palace' },
          { img: require('@/assets/images/portfolio/indian_bride.jpg'), title: 'Bride' }
        ];
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Dynamic Greeting Hero */}
        <View style={styles.heroSection}>
          <Text style={styles.greetingText}>{headerInfo.greeting}</Text>
          <Text style={styles.subtitleText}>{headerInfo.subtitle}</Text>
        </View>

        {/* Layer 2: "What's Happening" (Active Circle Cards) */}
        {token && events.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>WHAT'S HAPPENING</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {events.map((ev) => {
                const isUpcoming = new Date(ev.date) > new Date();
                const isProcessing = new Date(ev.date) <= new Date() && !ev.galleryFacesComplete;

                let cardBadge = 'READY';
                let badgeColor = '#4caf50';
                let statusMsg = `${ev.matchedCount || 0} photo${ev.matchedCount === 1 ? '' : 's'} matched`;

                if (isUpcoming) {
                  const days = Math.ceil((new Date(ev.date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                  cardBadge = 'UPCOMING';
                  badgeColor = '#00bcd4';
                  statusMsg = `${days} days left until wedding`;
                } else if (isProcessing) {
                  cardBadge = 'CURATING';
                  badgeColor = '#ff9800';
                  statusMsg = 'Photos are being sorted';
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
                        <Text style={styles.badgeText}>{cardBadge}</Text>
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
            {FEATURED_STORIES.map((story) => (
              <Pressable 
                key={story.id} 
                style={styles.featuredCard}
                onPress={() => setSelectedStory(story)}
              >
                <Image source={story.coverImage} style={styles.featuredImage} />
                <View style={styles.featuredOverlay} />
                <View style={styles.featuredContent}>
                  <Text style={styles.featuredLocation}>{story.location.toUpperCase()}</Text>
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
            {VIBES.map((vibe) => (
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
            {getFilteredVibeImages().map((item, index) => (
              <View key={index} style={styles.vibeGalleryItem}>
                <Image source={item.img} style={styles.vibeGalleryImage} />
                <Text style={styles.vibeGalleryLabel}>{item.title}</Text>
              </View>
            ))}
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
    paddingTop: 24,
    paddingBottom: 32,
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
    backgroundColor: '#fbfaf8',
  },
  greetingText: {
    fontFamily: 'System',
    fontSize: 24,
    fontWeight: '700',
    color: '#1c1a18',
    marginBottom: 8,
  },
  subtitleText: {
    fontFamily: 'serif',
    fontSize: 13,
    lineHeight: 18,
    color: '#60646c',
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
    backgroundColor: 'rgba(28, 26, 24, 0.45)',
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
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '600',
    color: '#8c867e',
    marginTop: 6,
    textAlign: 'center',
    letterSpacing: 0.5,
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
