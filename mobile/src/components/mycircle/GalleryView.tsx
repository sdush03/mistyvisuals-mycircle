import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Alert,
  StatusBar,
  BackHandler,
  Image as RNImage,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, runOnJS, Easing } from 'react-native-reanimated';
import { useAuthStore } from '../../store/authStore';
import { useScrollTabBarCollapse } from '../../hooks/useScrollTabBarCollapse';
import api, { guestApi } from '../../services/api';
import { MasonryCard } from '../home/lightbox/components/MasonryCard';
import { EditorialLightbox, LightboxBounds } from '../home/lightbox/EditorialLightbox';
import {
  FONT_MONTSERRAT_REGULAR,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';

const { width, height: screenHeight } = Dimensions.get('window');

interface Photo {
  id: number;
  r2Url: string;
  width?: number;
  height?: number;
  isLiked?: boolean;
  likeCount?: number;
  [key: string]: any;
}

interface GalleryViewProps {
  onLogout: () => void;
  onChangeEvent: () => void;
}

export default function GalleryView({ onLogout, onChangeEvent }: GalleryViewProps) {
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [allPhotos, setAllPhotos] = useState<Photo[]>([]);
  const [totalAllPhotosCount, setTotalAllPhotosCount] = useState<number | null>(null);
  const [eventDetails, setEventDetailsData] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'matched' | 'all'>('matched');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [allPhotosOffset, setAllPhotosOffset] = useState(0);
  const [hasMorePhotos, setHasMorePhotos] = useState(true);

  // Lightbox State
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [selectedBounds, setSelectedBounds] = useState<LightboxBounds | null>(null);

  const mainScrollRef = useRef<ScrollView>(null);
  const cardRefs = useRef<{ [key: string]: View | null }>({});
  const eventHeadersRef = useRef<Record<string, string>>({});

  // Reanimated values for edge-swipe back gesture
  const screenSwipeX = useSharedValue(0);
  const touchStartedOnLeftEdge = useSharedValue(false);
  const isLightboxOpen = useSharedValue(false);

  useEffect(() => {
    isLightboxOpen.value = activeImageIndex !== null;
  }, [activeImageIndex]);

  const handleBackAction = useCallback(() => {
    if (activeImageIndex !== null) {
      setActiveImageIndex(null);
    } else {
      onChangeEvent();
    }
  }, [activeImageIndex, onChangeEvent]);

  // Native Android Back Button Listener
  useEffect(() => {
    const onBack = () => {
      handleBackAction();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => subscription.remove();
  }, [handleBackAction]);

  // Left-Edge Pan Swipe Back Gesture (matching FeaturedStoryView)
  const edgeSwipeGesture = Gesture.Pan()
    .activeOffsetX(5)
    .failOffsetY([-20, 20])
    .onBegin((e) => {
      'worklet';
      touchStartedOnLeftEdge.value = e.x <= 65 && !isLightboxOpen.value;
    })
    .onUpdate((e) => {
      'worklet';
      if (!touchStartedOnLeftEdge.value) return;
      if (e.translationX > 0) {
        screenSwipeX.value = e.translationX;
      }
    })
    .onEnd((e) => {
      'worklet';
      if (!touchStartedOnLeftEdge.value) return;
      if (e.translationX > width * 0.20 || e.velocityX > 250) {
        screenSwipeX.value = withTiming(width, { duration: 220, easing: Easing.out(Easing.quad) }, (finished) => {
          if (finished) {
            runOnJS(onChangeEvent)();
          }
        });
      } else {
        screenSwipeX.value = withSpring(0, { damping: 25, stiffness: 200 });
      }
      touchStartedOnLeftEdge.value = false;
    });

  const screenSwipeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: screenSwipeX.value }],
  }));

  const PAGE_SIZE = 100;

  const eventSlug = useAuthStore((state) => state.eventSlug);
  const passcode = useAuthStore((state) => state.passcode);
  const profile = useAuthStore((state) => state.profile);
  const eventCoverUrl = useAuthStore((state) => state.eventCoverUrl);
  const eventTitle = useAuthStore((state) => state.eventTitle);
  const handleScroll = useScrollTabBarCollapse();

  const fetchPhotos = async () => {
    try {
      setIsLoading(true);
      setAllPhotos([]);
      setAllPhotosOffset(0);
      setHasMorePhotos(true);
      setTotalAllPhotosCount(null);

      if (!eventSlug) return;

      // Fetch event metadata for cover screen
      try {
        const eventRes = await api.get(`/api/gallery/public/events/${eventSlug}`);
        if (eventRes.data) {
          setEventDetailsData(eventRes.data);
        }
      } catch (e: any) {
        if (e?.response?.status === 404) {
          Alert.alert('Celebration Not Found', 'This celebration is no longer available or the link is invalid.');
          onChangeEvent();
          return;
        }
        console.warn('Failed to fetch event details:', e);
      }

      const familyToken = useAuthStore.getState().token;
      const currentPasscode = useAuthStore.getState().passcode;

      // 1. SSO Token Exchange: Obtain event guest token for this celebration
      try {
        const ssoRes = await api.post(
          `/api/gallery/public/events/${eventSlug}/auth-from-family`,
          { code: currentPasscode || undefined },
          { headers: familyToken ? { Authorization: `Bearer ${familyToken}` } : {} }
        );
        if (ssoRes.data?.token) {
          eventHeadersRef.current = { Authorization: `Bearer ${ssoRes.data.token}` };
        } else if (familyToken) {
          eventHeadersRef.current = { Authorization: `Bearer ${familyToken}` };
        }
      } catch (e: any) {
        if (e?.response?.status === 404) {
          Alert.alert('Celebration Not Found', 'This celebration is no longer available or the link is invalid.');
          onChangeEvent();
          return;
        }
        const errDetail = e?.response?.data?.error || (typeof e?.response?.data === 'string' ? e?.response?.data : JSON.stringify(e?.response?.data)) || e?.message;
        console.warn('SSO token exchange failed:', errDetail);
        if (familyToken) {
          eventHeadersRef.current = { Authorization: `Bearer ${familyToken}` };
        }
      }

      const eventHeaders = eventHeadersRef.current;

      const mapPhotoItem = (p: any): Photo => {
        const uri = p.r2Url || p.thumbnailUrl || p.r2_url || p.file_url_mobile || p.file_url || p.url || '';
        return {
          id: p.id,
          r2Url: uri,
          uri,
          fullUri: uri,
          photoUrl: uri,
          width: p.width,
          height: p.height,
          isLiked: !!(p.likes && p.likes.length > 0),
          likeCount: p._count?.likes || 0,
        };
      };

      // 2. Fetch matched photos independently using guest token
      try {
        const matchedRes = await guestApi.get(
          `/api/gallery/public/events/${eventSlug}/matched-photos`,
          { headers: eventHeaders }
        );
        const matchedList = matchedRes.data.photos || matchedRes.data.matchedPhotos || (Array.isArray(matchedRes.data) ? matchedRes.data : []);
        setPhotos(Array.isArray(matchedList) ? matchedList.map(mapPhotoItem) : []);
      } catch (e: any) {
        console.warn('Matched photos fetch error:', e?.response?.status, e?.response?.data?.error);
        setPhotos([]);
      }

      // 3. Fetch first page of all photos using guest token
      try {
        const allRes = await guestApi.get(
          `/api/gallery/public/events/${eventSlug}/photos?limit=${PAGE_SIZE}&offset=0`,
          { headers: eventHeaders }
        );
        const allList = allRes.data.photos || (Array.isArray(allRes.data) ? allRes.data : []);
        const mapped = Array.isArray(allList) ? allList.map(mapPhotoItem) : [];
        const total = typeof allRes.data.total === 'number' ? allRes.data.total : mapped.length;
        setTotalAllPhotosCount(total);
        setAllPhotos(mapped);
        setAllPhotosOffset(mapped.length);
        setHasMorePhotos(mapped.length < total);
      } catch (e: any) {
        console.warn('All photos fetch error:', e?.response?.status, e?.response?.data?.error);
        setAllPhotos([]);
      }
    } catch (err) {
      console.warn('Failed to fetch gallery photos', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMorePhotos = async () => {
    if (!hasMorePhotos || isLoadingMore || isLoading || !eventSlug) return;
    try {
      setIsLoadingMore(true);
      const eventHeaders = eventHeadersRef.current;
      const allRes = await guestApi.get(
        `/api/gallery/public/events/${eventSlug}/photos?limit=${PAGE_SIZE}&offset=${allPhotosOffset}`,
        { headers: eventHeaders }
      );
      const allList = allRes.data.photos || (Array.isArray(allRes.data) ? allRes.data : []);
      const mapPhotoItem = (p: any): Photo => {
        const uri = p.r2Url || p.thumbnailUrl || p.r2_url || p.file_url_mobile || p.file_url || p.url || '';
        return {
          id: p.id,
          r2Url: uri,
          uri,
          fullUri: uri,
          photoUrl: uri,
          width: p.width,
          height: p.height,
          isLiked: !!(p.likes && p.likes.length > 0),
          likeCount: p._count?.likes || 0,
        };
      };
      const mapped = Array.isArray(allList) ? allList.map(mapPhotoItem) : [];
      if (mapped.length > 0) {
        setAllPhotos((prev) => {
          const next = [...prev, ...mapped];
          if (totalAllPhotosCount !== null && next.length >= totalAllPhotosCount) {
            setHasMorePhotos(false);
          }
          return next;
        });
        setAllPhotosOffset((prev) => prev + mapped.length);
      } else {
        setHasMorePhotos(false);
      }
    } catch (e: any) {
      console.warn('Load more error:', e?.response?.status);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchPhotos();
  }, [eventSlug]);

  // Auto-switch to 'all' photos tab if matched photos count is 0
  useEffect(() => {
    if (!isLoading && photos.length === 0 && allPhotos.length > 0) {
      setViewMode('all');
    }
  }, [isLoading, photos.length, allPhotos.length]);

  const activeList = viewMode === 'matched' ? photos : allPhotos;

  // Shortest Column Height Balancing — EXACTLY matching FeaturedStoryView
  const { column0, column1 } = React.useMemo(() => {
    const cols: [any[], any[]] = [[], []];
    const colHeights = [0, 0];

    activeList.forEach((photo: any, index: number) => {
      const realAspect = photo.width && photo.height && Number(photo.height) > 0
        ? Number(photo.width) / Number(photo.height)
        : (photo.aspectRatio || null);

      const isLandscape = realAspect ? realAspect > 1.05 : photo.isHorizontal;

      let cardAspect = 0.75;
      if (isLandscape) {
        cardAspect = realAspect && realAspect > 1.0 ? realAspect : 1.5;
      } else {
        const cycle = index % 3;
        cardAspect = cycle === 0 ? 2 / 3 : cycle === 1 ? 3 / 4 : 4 / 5;
      }

      const photoWithAspect = {
        ...photo,
        aspectRatio: cardAspect,
        cardAspect,
        globalIndex: index,
      };

      const heightContribution = 1 / cardAspect;
      const shortestIdx = colHeights[0] <= colHeights[1] ? 0 : 1;
      cols[shortestIdx].push(photoWithAspect);
      colHeights[shortestIdx] += heightContribution;
    });

    return { column0: cols[0], column1: cols[1] };
  }, [activeList]);

  // Bounds measurement for smooth Lightbox opening & background page auto-scrolling
  const getBoundsForIndex = useCallback((idx: number, callback: (bounds: LightboxBounds) => void) => {
    if (idx < 0 || idx >= activeList.length) return;
    const item = activeList[idx];
    if (!item) return;
    const cardId = item.id ? String(item.id) : (item.r2Url || `photo-${idx}`);
    const targetCard = cardRefs.current[cardId];

    if (targetCard) {
      targetCard.measureInWindow((x, y, cardWidth, cardHeight) => {
        if (cardWidth > 0 && cardHeight > 0) {
          if (y < 80 || y + cardHeight > Dimensions.get('screen').height - 60) {
            targetCard.measureLayout(
              mainScrollRef.current as any,
              (left, top, w, h) => {
                const targetScrollY = Math.max(0, top - Dimensions.get('screen').height / 2 + h / 2);
                mainScrollRef.current?.scrollTo({ y: targetScrollY, animated: false });
                requestAnimationFrame(() => {
                  targetCard.measureInWindow((nx, ny, nw, nh) => {
                    if (nw > 0 && nh > 0) {
                      callback({ x: nx, y: ny, width: nw, height: nh });
                    }
                  });
                });
              },
              () => {}
            );
          } else {
            callback({ x, y, width: cardWidth, height: cardHeight });
          }
        }
      });
    }
  }, [activeList]);

  const openLightbox = (photoItem: any, bounds: LightboxBounds | null) => {
    setSelectedBounds(bounds);
    const idx = activeList.findIndex((p) => p.id === photoItem.id);
    setActiveImageIndex(idx !== -1 ? idx : (photoItem.globalIndex ?? 0));
  };

  // Header Cover Metadata
  const coverUrl =
    eventCoverUrl ||
    eventDetails?.coverPhotoMobileUrl ||
    eventDetails?.coverPhotoUrl ||
    (activeList[0]?.r2Url) ||
    null;

  const cleanTitle = (eventTitle || eventDetails?.title || eventSlug || 'WEDDING CELEBRATION')
    .replace(/'s\s+Wedding/gi, '')
    .replace('&', '·')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  const locationText = (eventDetails?.location || eventDetails?.city || '').toUpperCase();
  const dateText = eventDetails?.date
    ? new Date(eventDetails.date).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
    : '';

  return (
    <GestureHandlerRootView style={styles.container}>
      <GestureDetector gesture={edgeSwipeGesture}>
        <Animated.View style={[{ flex: 1, backgroundColor: '#ffffff' }, screenSwipeAnimatedStyle]}>
          <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

          {/* Borderless Editorial Back Button (Exact Featured Story Style) */}
          <Pressable
            style={[styles.editorialBackButton, { top: Math.max(insets.top + 10, 42) }]}
            onPress={onChangeEvent}
            hitSlop={16}
          >
            <Text style={styles.editorialBackText}>← BACK</Text>
          </Pressable>

          <ScrollView
            ref={mainScrollRef}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={true}
            scrollEventThrottle={16}
            onScroll={(e) => {
              handleScroll(e);
              // Infinite Scroll threshold listener
              const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
              const isNearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 800;
              if (isNearBottom && viewMode === 'all') {
                loadMorePhotos();
              }
            }}
          >
            {/* ── 1. Hero Cover Banner (Exact Featured Story Style) ── */}
            <View style={styles.heroContainer}>
              {coverUrl ? (
                <Image
                  source={{ uri: coverUrl }}
                  style={styles.heroImage}
                  contentFit="cover"
                  priority="high"
                  cachePolicy="memory-disk"
                  transition={200}
                />
              ) : (
                <View style={[styles.heroImage, { backgroundColor: '#1c1a18', justifyContent: 'center', alignItems: 'center' }]}>
                  <ActivityIndicator size="small" color="#ffffff" />
                </View>
              )}

              {/* White Brand Logo on Cover */}
              <View style={[styles.coverHeaderLogoContainer, { top: insets.top + 6 }]} pointerEvents="none">
                <RNImage
                  source={require('../../../assets/images/logo-white.png')}
                  style={styles.coverHeaderLogo}
                  resizeMode="contain"
                />
              </View>

              {/* Vignette Gradient Overlay */}
              <LinearGradient
                colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.1)', 'rgba(0,0,0,0.75)']}
                locations={[0, 0.45, 1]}
                style={styles.heroOverlay}
              />

              {/* Cover Title Container */}
              <View style={[styles.titleContainer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
                {locationText ? <Text style={styles.storyLocation}>{locationText}</Text> : null}
                <Text style={styles.storyTitle}>{cleanTitle}</Text>
                {dateText ? <Text style={styles.storyDate}>{dateText}</Text> : null}
              </View>
            </View>

            {/* ── 2. Category Tabs (Exact Featured Story Style) ── */}
            <View style={styles.galleryContainer}>
              <View style={styles.tabsWrapper}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tabsScrollContent}
                >
                  <Pressable
                    onPress={() => setViewMode('matched')}
                    style={[styles.tabButton, viewMode === 'matched' && styles.tabButtonActive]}
                  >
                    <Text style={[styles.tabText, viewMode === 'matched' && styles.tabTextActive]}>
                      MATCHED ({photos.length})
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setViewMode('all')}
                    style={[styles.tabButton, viewMode === 'all' && styles.tabButtonActive]}
                  >
                    <Text style={[styles.tabText, viewMode === 'all' && styles.tabTextActive]}>
                      ALL PHOTOS ({totalAllPhotosCount !== null ? totalAllPhotosCount.toLocaleString() : allPhotos.length})
                    </Text>
                  </Pressable>
                </ScrollView>
              </View>

              {/* ── 4. 2-Column Balanced Masonry Grid ── */}
              {isLoading ? (
                <View style={styles.masonryGridContainer}>
                  <View style={styles.masonryColumn}>
                    {[0.75, 0.67, 0.8].map((aspect, i) => (
                      <View key={`sk0-${i}`} style={[styles.masonryCard, styles.skeletonCard, { aspectRatio: aspect }]} />
                    ))}
                  </View>
                  <View style={styles.masonryColumn}>
                    {[0.67, 0.8, 0.75].map((aspect, i) => (
                      <View key={`sk1-${i}`} style={[styles.masonryCard, styles.skeletonCard, { aspectRatio: aspect }]} />
                    ))}
                  </View>
                </View>
              ) : activeList.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    {viewMode === 'matched'
                      ? "We couldn't find any photos matched with your face yet. Switch to ALL PHOTOS to view the full gallery!"
                      : 'No photos have been uploaded to this gallery yet.'}
                  </Text>
                </View>
              ) : (
                <View style={styles.masonryGridContainer}>
                  <View style={styles.masonryColumn}>
                    {column0.map((img, idx) => {
                      const cardId = img.id ? String(img.id) : (img.r2Url || `col0-${idx}`);
                      return (
                        <MasonryCard
                          key={cardId}
                          img={img}
                          index={idx}
                          isColumn0={true}
                          onSelect={(bounds) => openLightbox(img, bounds)}
                          onRegisterRef={(id, ref) => {
                            if (id) cardRefs.current[id] = ref;
                            if (cardId) cardRefs.current[cardId] = ref;
                          }}
                        />
                      );
                    })}
                  </View>
                  <View style={styles.masonryColumn}>
                    {column1.map((img, idx) => {
                      const cardId = img.id ? String(img.id) : (img.r2Url || `col1-${idx}`);
                      return (
                        <MasonryCard
                          key={cardId}
                          img={img}
                          index={idx}
                          isColumn0={false}
                          onSelect={(bounds) => openLightbox(img, bounds)}
                          onRegisterRef={(id, ref) => {
                            if (id) cardRefs.current[id] = ref;
                            if (cardId) cardRefs.current[cardId] = ref;
                          }}
                        />
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Loading indicator when fetching next page */}
              {viewMode === 'all' && isLoadingMore ? (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color="#8c867e" />
                </View>
              ) : null}
            </View>
          </ScrollView>
        </Animated.View>
      </GestureDetector>

      {/* ── 5. Universal Editorial Lightbox Component ── */}
      {activeImageIndex !== null && (
        <EditorialLightbox
          visible={activeImageIndex !== null}
          images={activeList}
          initialIndex={activeImageIndex}
          initialBounds={selectedBounds}
          onGetBoundsForIndex={getBoundsForIndex}
          onClose={() => setActiveImageIndex(null)}
          title={cleanTitle}
          subtitle={viewMode === 'matched' ? 'MATCHED MEMORIES' : 'CELEBRATION GALLERY'}
        />
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  editorialBackButton: {
    position: 'absolute',
    left: 24,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  editorialBackText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  heroContainer: {
    width: '100%',
    height: Math.round(screenHeight * 0.70),
    position: 'relative',
    backgroundColor: '#1c1a18',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  coverHeaderLogoContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 95,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverHeaderLogo: {
    width: 135,
    height: 38,
  },
  titleContainer: {
    position: 'absolute',
    bottom: 30,
    left: 24,
    right: 24,
  },
  storyLocation: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 10,
    letterSpacing: 3,
    color: '#ffffff',
    marginBottom: 8,
    opacity: 0.9,
  },
  storyTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 32,
    color: '#ffffff',
    marginBottom: 8,
    lineHeight: 38,
  },
  storyDate: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    letterSpacing: 1,
    color: '#ffffff',
    opacity: 0.8,
  },
  editorialContainer: {
    paddingHorizontal: 28,
    paddingVertical: 32,
    alignItems: 'center',
    backgroundColor: '#fbfaf8',
  },
  subtitleText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    letterSpacing: 2.5,
    color: '#8c867e',
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '600',
  },
  descriptionText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 14,
    lineHeight: 24,
    color: '#4a4540',
    textAlign: 'center',
  },
  galleryContainer: {
    paddingHorizontal: 8,
    paddingTop: 20,
  },
  tabsWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
    marginBottom: 16,
  },
  tabsScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 20,
  },
  tabButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabButtonActive: {
    borderBottomColor: '#1c1a18',
  },
  tabText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    letterSpacing: 2,
    color: '#8c867e',
  },
  tabTextActive: {
    color: '#1c1a18',
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontWeight: '600',
  },
  masonryGridContainer: {
    flexDirection: 'row',
    gap: 6,
    width: '100%',
  },
  masonryColumn: {
    flex: 1,
    flexDirection: 'column',
    gap: 6,
  },
  masonryCard: {
    width: '100%',
    backgroundColor: '#f5f5f5',
    overflow: 'hidden',
  },
  skeletonCard: {
    backgroundColor: '#eae6e1',
    opacity: 0.7,
  },
  emptyContainer: {
    paddingVertical: 60,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 14,
    lineHeight: 24,
    color: '#8c867e',
    textAlign: 'center',
  },
});
