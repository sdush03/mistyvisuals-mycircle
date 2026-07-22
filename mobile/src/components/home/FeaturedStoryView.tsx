import React, { useState, useRef, useCallback } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  Modal, 
  ScrollView, 
  Pressable, 
  Dimensions,
  StatusBar,
  FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from 'react-native-reanimated';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';
import { savesService } from '../../services/savesService';

const { width, height: screenHeight } = Dimensions.get('screen');

interface Story {
  id: string;
  title: string;
  subtitle: string;
  location: string;
  date: string;
  coverImage: any;
  description: string;
  images: any[];
  tabs?: string[];
}

interface FeaturedStoryViewProps {
  isOpen: boolean;
  onClose: () => void;
  story: Story | null;
}

const formatDateText = (rawDate?: string): string => {
  if (!rawDate) return '';
  const isoMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const monthIndex = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    if (months[monthIndex]) return `${months[monthIndex]} ${day}, ${year}`;
  }
  const parsed = new Date(rawDate);
  if (!isNaN(parsed.getTime())) {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return `${months[parsed.getMonth()]} ${parsed.getDate()}, ${parsed.getFullYear()}`;
  }
  return rawDate;
};

const MasonryCard = React.memo(function MasonryCard({ 
  img, index, isColumn0, onSelect 
}: { 
  img: any; index: number; isColumn0: boolean; onSelect: () => void;
}) {
  const primaryUri = typeof img === 'object' && img.uri ? img.uri : (typeof img === 'string' ? img : '');
  const fallbackUri = typeof img === 'object' && img.fullUri ? img.fullUri : '';
  const blurUri = typeof img === 'object' && img.blurUri ? img.blurUri : null;
  const [currentUri, setCurrentUri] = useState<string>(primaryUri);

  React.useEffect(() => { setCurrentUri(primaryUri); }, [primaryUri]);

  const cardAspect = (typeof img === 'object' && img.cardAspect)
    ? img.cardAspect
    : ((typeof img === 'object' && img.aspectRatio && !isNaN(img.aspectRatio) && img.aspectRatio > 0)
      ? img.aspectRatio
      : ((index + (isColumn0 ? 0 : 1)) % 3 === 0 ? 0.67 : ((index + (isColumn0 ? 0 : 1)) % 3 === 1 ? 0.75 : 0.80)));

  return (
    <Pressable style={[styles.masonryCard, { aspectRatio: cardAspect }]} onPress={onSelect}>
      {currentUri ? (
        <Image
          source={{ uri: currentUri }}
          style={styles.masonryImage}
          contentFit="cover"
          priority="normal"
          cachePolicy="memory-disk"
          // Grid quality blur placeholder — replaced by actual image on load
          placeholder={blurUri ? { uri: blurUri } : undefined}
          placeholderContentFit="cover"
          transition={blurUri ? 200 : 0}
          onError={() => { if (fallbackUri && currentUri !== fallbackUri) setCurrentUri(fallbackUri); }}
        />
      ) : null}
    </Pressable>
  );
});

export default function FeaturedStoryView({ isOpen, onClose, story }: FeaturedStoryViewProps) {
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<string>('ALL');
  // FIX 1: start at 40, bump to Infinity after 150ms
  const [renderLimit, setRenderLimit] = useState<number>(40);
  const insets = useSafeAreaInsets();

  // Reanimated shared values for smooth pinch-to-zoom + swipe animations (UI thread)
  const pinchScale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const isFirstPhoto = useSharedValue(false);
  const isLastPhoto = useSharedValue(false);

  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (isOpen) {
      setActiveTab('ALL');
      setActiveImageIndex(null);
      savesService.getSavedPhotos().then((items) => {
        const urls = new Set(items.map((i) => i.photoUrl));
        setSavedUrls(urls);
      });
    }
  }, [isOpen, story]);

  React.useEffect(() => {
    if (isOpen) {
      setRenderLimit(40);
      // After first 40 render, load everything else quietly (runs on modal open AND tab switches)
      const timer = setTimeout(() => setRenderLimit(Infinity as any), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, story, activeTab]);

  // Reset zoom & transform when photo changes
  React.useEffect(() => {
    pinchScale.value = withSpring(1, { damping: 20 });
    savedScale.value = 1;
    translateX.value = 0;
    opacity.value = 1;
  }, [activeImageIndex]);

  const galleryImages = React.useMemo(() => {
    if (!story || !Array.isArray(story.images)) return [];
    return story.images;
  }, [story]);

  const availableTabs = React.useMemo(() => {
    if (!story) return ['ALL'];
    const catSet = new Set<string>();
    if (story.tabs) {
      if (Array.isArray(story.tabs)) {
        story.tabs.forEach((t: any) => {
          if (typeof t === 'string' && t.trim() && t.trim().length <= 25) catSet.add(t.trim());
        });
      } else if (typeof story.tabs === 'string') {
        (story.tabs as string).split(',').forEach((t: string) => {
          if (t.trim() && t.trim().length <= 25) catSet.add(t.trim());
        });
      }
    }
    galleryImages.forEach((img: any) => {
      if (img && typeof img === 'object' && img.category) {
        String(img.category).split(',').forEach((c: string) => {
          if (c.trim() && c.trim().length <= 25) catSet.add(c.trim());
        });
      }
    });
    const uniqueTabs = Array.from(catSet).filter(t => t.toUpperCase() !== 'ALL');
    return uniqueTabs.length === 0 ? ['ALL'] : ['ALL', ...uniqueTabs];
  }, [story, galleryImages]);

  const filteredGalleryImages = React.useMemo(() => {
    if (activeTab.toUpperCase() === 'ALL') return galleryImages;
    const tabLower = activeTab.toLowerCase().trim();
    const filtered = galleryImages.filter((img: any) => {
      if (!img) return false;
      const rawCat = typeof img === 'object' ? String(img.category || '') : '';
      if (!rawCat) return false;
      const catLower = rawCat.toLowerCase().trim();
      const parts = catLower.split(',').map(s => s.trim());
      return parts.some(c => c === tabLower || c.includes(tabLower) || tabLower.includes(c));
    });
    return filtered;
  }, [galleryImages, activeTab]);

  // FIX 1: slice to renderLimit for the grid only — lightbox still uses full filteredGalleryImages
  const visibleImages = React.useMemo(() => {
    const limit = renderLimit as number;
    return isFinite(limit) ? filteredGalleryImages.slice(0, limit) : filteredGalleryImages;
  }, [filteredGalleryImages, renderLimit]);

  // Shortest Column Height Balancing — portrait always cycles 2/3 → 3/4 → 4/5
  const { column0, column1 } = React.useMemo(() => {
    const cols: [any[], any[]] = [[], []];
    const colHeights = [0, 0];

    visibleImages.forEach((photo: any, index: number) => {
      const realAspect = (photo.width && photo.height && Number(photo.height) > 0)
        ? (Number(photo.width) / Number(photo.height))
        : (photo.aspectRatio || null);

      const isLandscape = realAspect ? realAspect > 1.05 : photo.isHorizontal;

      let cardAspect = 0.75;
      if (isLandscape) {
        // Landscape: use real ratio for accurate card width, fallback to 3:2
        cardAspect = (realAspect && realAspect > 1.0) ? realAspect : 1.5;
      } else {
        // Portrait: always cycle 2/3 → 3/4 → 4/5 for visual rhythm
        const cycle = index % 3;
        cardAspect = cycle === 0 ? 2/3 : (cycle === 1 ? 3/4 : 4/5);
      }

      const photoWithAspect = { ...photo, cardAspect };
      const heightContribution = 1 / cardAspect;
      const shortestIdx = colHeights[0] <= colHeights[1] ? 0 : 1;
      cols[shortestIdx].push(photoWithAspect);
      colHeights[shortestIdx] += heightContribution;
    });

    return { column0: cols[0], column1: cols[1] };
  }, [visibleImages]);

  // Update first / last photo boundaries for rubber-banding & swipe logic
  React.useEffect(() => {
    if (activeImageIndex !== null && filteredGalleryImages.length > 0) {
      isFirstPhoto.value = activeImageIndex === 0;
      isLastPhoto.value = activeImageIndex === filteredGalleryImages.length - 1;
    }
  }, [activeImageIndex, filteredGalleryImages]);

  // ── FIX 2: UI-thread swipe + pinch via RNGH v2 Gesture API ──────────────

  // Stable navigate ref — always points to latest closure without recreating gestures
  const navigateRef = useRef((dir: 'next' | 'prev') => {});
  navigateRef.current = (dir: 'next' | 'prev') => {
    setActiveImageIndex(prev => {
      if (prev === null) return prev;
      if (dir === 'next') return prev < filteredGalleryImages.length - 1 ? prev + 1 : prev;
      return prev > 0 ? prev - 1 : prev;
    });
  };
  // Stable wrapper so runOnJS never gets a stale reference
  const navigate = useCallback((dir: 'next' | 'prev') => navigateRef.current(dir), []);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      pinchScale.value = Math.max(1, Math.min(savedScale.value * e.scale, 4.5));
    })
    .onEnd(() => {
      if (pinchScale.value <= 1.05) {
        pinchScale.value = withSpring(1, { damping: 20 });
        savedScale.value = 1;
      } else {
        savedScale.value = pinchScale.value;
      }
    });

  // Pan gesture runs entirely on the UI thread with real-time finger tracking & spring exit/entry
  const panGesture = Gesture.Pan()
    .activeOffsetX([-8, 8])      // activate after 8px horizontal drag
    .failOffsetY([-25, 25])      // allow scrollview to handle vertical scroll if user pulls down
    .onUpdate((e) => {
      'worklet';
      if (pinchScale.value > 1.05) return; // disable swipe when zoomed in

      // Rubber-banding if user tries to swipe past ends
      if ((isFirstPhoto.value && e.translationX > 0) || (isLastPhoto.value && e.translationX < 0)) {
        translateX.value = e.translationX * 0.3;
      } else {
        translateX.value = e.translationX;
        const absX = Math.abs(e.translationX);
        opacity.value = Math.max(0.65, 1 - absX / (width * 1.5));
      }
    })
    .onEnd((e) => {
      'worklet';
      if (pinchScale.value > 1.05) return;

      const SWIPE_THRESHOLD = width * 0.22;
      const velocityX = e.velocityX;

      const isSwipeNext = (e.translationX < -SWIPE_THRESHOLD || velocityX < -400) && !isLastPhoto.value;
      const isSwipePrev = (e.translationX > SWIPE_THRESHOLD || velocityX > 400) && !isFirstPhoto.value;

      if (isSwipeNext) {
        // Slide out to left
        translateX.value = withTiming(-width * 0.85, { duration: 160 }, (finished) => {
          if (finished) {
            runOnJS(navigate)('next');
            translateX.value = width * 0.35;
            opacity.value = 1;
            translateX.value = withSpring(0, { damping: 22, stiffness: 220 });
          }
        });
      } else if (isSwipePrev) {
        // Slide out to right
        translateX.value = withTiming(width * 0.85, { duration: 160 }, (finished) => {
          if (finished) {
            runOnJS(navigate)('prev');
            translateX.value = -width * 0.35;
            opacity.value = 1;
            translateX.value = withSpring(0, { damping: 22, stiffness: 220 });
          }
        });
      } else {
        // Snap back to center smoothly
        translateX.value = withSpring(0, { damping: 22, stiffness: 220 });
        opacity.value = withSpring(1);
      }
    });

  const lightboxGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { scale: pinchScale.value }
    ],
    opacity: opacity.value,
  }));

  if (!story) return null;

  const locationText = (story.location || '').toUpperCase();
  const titleText = story.title || '';
  const dateText = formatDateText(story.date);
  const descriptionText = story.description || '';

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <GestureHandlerRootView style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        {/* Borderless Editorial Back Button */}
        <Pressable
          style={[styles.editorialBackButton, { top: Math.max(insets.top + 16, 48) }]}
          onPress={onClose}
          hitSlop={16}
        >
          <Text style={styles.editorialBackIcon}>←</Text>
          <Text style={styles.editorialBackText}>BACK</Text>
        </Pressable>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={true}
          removeClippedSubviews={true}
          scrollEventThrottle={16}
          overScrollMode="never"
        >
          {/* Hero Banner */}
          <View style={styles.heroContainer}>
            <Image
              source={story.coverImage}
              style={styles.heroImage}
              contentFit="cover"
              priority="high"
              cachePolicy="memory-disk"
              transition={100}
            />
            <LinearGradient
              colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.1)', 'rgba(0,0,0,0.75)']}
              locations={[0, 0.45, 1]}
              style={styles.heroOverlay}
            />
            <View style={[styles.titleContainer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              {locationText ? <Text style={styles.storyLocation}>{locationText}</Text> : null}
              {titleText ? <Text style={styles.storyTitle}>{titleText}</Text> : null}
              {dateText ? <Text style={styles.storyDate}>{dateText}</Text> : null}
            </View>
          </View>

          {/* Editorial Content */}
          <View style={styles.editorialContainer}>
            {descriptionText ? <Text style={styles.descriptionText}>{descriptionText}</Text> : null}
          </View>

          {/* Photo Gallery Grid */}
          <View style={styles.galleryContainer}>
            {/* Category Tabs */}
            {availableTabs.length > 1 && (
              <View style={styles.tabsWrapper}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tabsScrollContent}
                >
                  {availableTabs.map((tab) => {
                    const isSelected = activeTab.toUpperCase() === tab.toUpperCase();
                    return (
                      <Pressable
                        key={tab}
                        onPress={() => { setActiveTab(tab); setRenderLimit(40); }}
                        style={[styles.tabButton, isSelected && styles.tabButtonActive]}
                      >
                        <Text style={[styles.tabText, isSelected && styles.tabTextActive]}>
                          {tab.toUpperCase()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Skeleton while loading */}
            {galleryImages.length === 0 ? (
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
            ) : (
              <View style={styles.masonryGridContainer}>
                <View style={styles.masonryColumn}>
                  {column0.map((img, idx) => (
                    <MasonryCard
                      key={img.id || `col0-${idx}`}
                      img={img}
                      index={idx}
                      isColumn0={true}
                      onSelect={() => {
                        const targetIdx = filteredGalleryImages.findIndex(item => item.id === img.id);
                        setActiveImageIndex(targetIdx !== -1 ? targetIdx : (img.originalIndex ?? 0));
                      }}
                    />
                  ))}
                </View>
                <View style={styles.masonryColumn}>
                  {column1.map((img, idx) => (
                    <MasonryCard
                      key={img.id || `col1-${idx}`}
                      img={img}
                      index={idx}
                      isColumn0={false}
                      onSelect={() => {
                        const targetIdx = filteredGalleryImages.findIndex(item => item.id === img.id);
                        setActiveImageIndex(targetIdx !== -1 ? targetIdx : (img.originalIndex ?? 0));
                      }}
                    />
                  ))}
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* ── Option 1: Minimalist Editorial Lightbox (Vogue / Kinfolk Style) ── */}
        {activeImageIndex !== null && (
          <Modal
            transparent={true}
            visible={true}
            animationType="fade"
            onRequestClose={() => setActiveImageIndex(null)}
            statusBarTranslucent={true}
          >
            <View style={styles.lightboxContainer}>
              <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

              {/* Top Editorial Header Gradient Overlay */}
              <LinearGradient
                colors={['rgba(0, 0, 0, 0.85)', 'rgba(0, 0, 0, 0.3)', 'transparent']}
                style={[styles.lightboxHeaderGradient, { paddingTop: Math.max(insets.top + 8, 44) }]}
                pointerEvents="box-none"
              >
                {(() => {
                  const currentImgForSave = activeImageIndex !== null ? filteredGalleryImages[activeImageIndex] : null;
                  const currentUrlForSave = currentImgForSave
                    ? (typeof currentImgForSave === 'object' && currentImgForSave.fullUri
                        ? currentImgForSave.fullUri
                        : (typeof currentImgForSave === 'object' && currentImgForSave.uri
                            ? currentImgForSave.uri
                            : (typeof currentImgForSave === 'string' ? currentImgForSave : '')))
                    : '';
                  const isCurrentPhotoSaved = savedUrls.has(currentUrlForSave);

                  const handleToggleCurrentPhotoSave = async () => {
                    if (!currentUrlForSave) return;
                    if (isCurrentPhotoSaved) {
                      const updated = new Set(savedUrls);
                      updated.delete(currentUrlForSave);
                      setSavedUrls(updated);
                      await savesService.unsavePhoto(currentUrlForSave);
                    } else {
                      const updated = new Set(savedUrls);
                      updated.add(currentUrlForSave);
                      setSavedUrls(updated);
                      await savesService.savePhoto(currentUrlForSave, story?.id);
                    }
                  };

                  return (
                    <View style={styles.lightboxHeaderInner}>
                      <View style={styles.lightboxHeaderBrand}>
                        <Text style={styles.lightboxBrandText}>MISTY VISUALS</Text>
                        <Text style={styles.lightboxBrandSub}>EDITORIAL</Text>
                      </View>
                      
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Pressable 
                          style={({ pressed }) => [
                            { paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
                            pressed && { opacity: 0.6 }
                          ]}
                          onPress={handleToggleCurrentPhotoSave}
                          hitSlop={14}
                        >
                          <Text style={{ fontSize: 22, color: isCurrentPhotoSaved ? '#FFD700' : '#FFFFFF' }}>
                            {isCurrentPhotoSaved ? '★' : '☆'}
                          </Text>
                        </Pressable>

                        <Pressable 
                          style={({ pressed }) => [
                            styles.lightboxCloseEditorial,
                            pressed && { opacity: 0.6 }
                          ]} 
                          onPress={() => setActiveImageIndex(null)}
                          hitSlop={14}
                        >
                          <Text style={styles.lightboxCloseIcon}>✕</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })()}
              </LinearGradient>

              {/* Native Horizontal Paging Lightbox Stage */}
              <View style={styles.lightboxImageContainer}>
                <FlatList
                  data={filteredGalleryImages}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  initialScrollIndex={activeImageIndex ?? 0}
                  getItemLayout={(data, index) => ({
                    length: width,
                    offset: width * index,
                    index,
                  })}
                  onMomentumScrollEnd={(e) => {
                    const newIdx = Math.round(e.nativeEvent.contentOffset.x / width);
                    if (newIdx >= 0 && newIdx < filteredGalleryImages.length) {
                      setActiveImageIndex(newIdx);
                    }
                  }}
                  keyExtractor={(item, index) => item.id || `lightbox-${index}`}
                  renderItem={({ item }) => {
                    const thumbnailUri = typeof item === 'object' && item.uri ? item.uri : (typeof item === 'string' ? item : null);
                    const fullUri = typeof item === 'object' && item.fullUri ? item.fullUri : thumbnailUri;

                    return (
                      <View style={{ width, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                        <View style={styles.lightboxImageStack}>
                          {/* Layer 1: Instant grid thumbnail from memory cache */}
                          {thumbnailUri && (
                            <Image
                              source={{ uri: thumbnailUri }}
                              style={[styles.lightboxImage, StyleSheet.absoluteFillObject]}
                              contentFit="contain"
                              cachePolicy="memory-disk"
                              priority="high"
                            />
                          )}
                          {/* Layer 2: High-res image fading in smoothly on top */}
                          {fullUri && fullUri !== thumbnailUri && (
                            <Image
                              source={{ uri: fullUri }}
                              style={styles.lightboxImage}
                              contentFit="contain"
                              cachePolicy="memory-disk"
                              priority="high"
                              transition={400}
                            />
                          )}
                        </View>
                      </View>
                    );
                  }}
                />
              </View>

              {/* Bottom Editorial Footer Gradient Overlay */}
              <LinearGradient
                colors={['transparent', 'rgba(0, 0, 0, 0.4)', 'rgba(0, 0, 0, 0.85)']}
                style={[styles.lightboxFooterGradient, { paddingBottom: Math.max(insets.bottom, 24) + 8 }]}
                pointerEvents="box-none"
              >
                {/* High-Fashion Format Counter: e.g. "01 // 24" placed ABOVE Title */}
                <View style={styles.lightboxCounterContainer}>
                  <Text style={styles.lightboxCounterCurrent}>
                    {String(activeImageIndex !== null ? activeImageIndex + 1 : 1).padStart(2, '0')}
                  </Text>
                  <Text style={styles.lightboxCounterDivider}>//</Text>
                  <Text style={styles.lightboxCounterTotal}>
                    {String(filteredGalleryImages.length).padStart(2, '0')}
                  </Text>
                </View>

                {/* Couple Name / Title / Category Tab */}
                {(() => {
                  const displayTitle = (story.title || '')
                    .replace(/'s\s+Wedding/gi, '')
                    .trim()
                    .toUpperCase();
                  const currentImg = activeImageIndex !== null ? filteredGalleryImages[activeImageIndex] : null;
                  const categoryName = (typeof currentImg === 'object' && currentImg && currentImg.category)
                    ? String(currentImg.category).toUpperCase()
                    : null;
                  const titleLabel = categoryName ? `${displayTitle}  ·  ${categoryName}` : displayTitle;

                  return titleLabel ? (
                    <Text style={styles.lightboxCategoryText}>{titleLabel}</Text>
                  ) : null;
                })()}
              </LinearGradient>
            </View>
          </Modal>
        )}
      </GestureHandlerRootView>
    </Modal>
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
  editorialBackIcon: {
    color: '#ffffff',
    fontSize: 19,
    lineHeight: 19,
    marginRight: 3,
    transform: [{ translateY: -3.5 }],
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  editorialBackText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 3,
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
    resizeMode: 'cover',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
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
    paddingVertical: 44,
    alignItems: 'center',
    backgroundColor: '#fbfaf8',
  },
  descriptionText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 15,
    lineHeight: 26,
    color: '#4a4540',
    textAlign: 'center',
  },
  galleryContainer: {
    paddingHorizontal: 8,
    paddingTop: 24,
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
  masonryImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  // Minimalist Editorial Lightbox (Vogue Style)
  lightboxContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  lightboxHeaderGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  lightboxHeaderInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  lightboxHeaderBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lightboxBrandText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12,
    letterSpacing: 3,
    color: '#ffffff',
    fontWeight: '500',
  },
  lightboxBrandSub: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    letterSpacing: 2,
    color: '#8c867e',
    fontWeight: '500',
  },
  lightboxCloseEditorial: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxCloseIcon: {
    color: '#ffffff',
    fontSize: 13,
    lineHeight: 13,
    fontWeight: '300',
  },
  lightboxImageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxImageStack: {
    width: width,
    height: '82%',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxImage: {
    width: width,
    height: '100%',
  },
  lightboxFooterGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  lightboxCategoryText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    letterSpacing: 2,
    color: '#8c867e',
    fontWeight: '500',
    marginBottom: 10,
    textAlign: 'center',
  },
  lightboxCounterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  lightboxCounterCurrent: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 15,
    fontWeight: '500',
    color: '#ffffff',
    letterSpacing: 2,
  },
  lightboxCounterDivider: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: '#6e6962',
  },
  lightboxCounterTotal: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12,
    color: '#8c867e',
    letterSpacing: 2,
  },
});
