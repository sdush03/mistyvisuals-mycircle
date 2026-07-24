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
  Share,
  BackHandler,
  Image as RNImage,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
// @ts-ignore
import { AntDesign, Feather, Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, withSequence, withDecay, Easing, runOnJS, SharedValue, useAnimatedReaction } from 'react-native-reanimated';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';
import { savesService } from '../../services/savesService';
import { formatDateText } from './lightbox/utils/date';
import { MasonryCard } from './lightbox/components/MasonryCard';
import { LightboxImageItem } from './lightbox/components/LightboxImageItem';
import { useAutoHideTimer } from './lightbox/hooks/useAutoHideTimer';

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

export default function FeaturedStoryView({ isOpen, onClose, story }: FeaturedStoryViewProps) {
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  // Shared value mirror of activeImageIndex for reliable worklet access (JS state is not safe in worklets)
  const isLightboxOpen = useSharedValue(false);
  const [activeTab, setActiveTab] = useState<string>('ALL');

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

  const {
    isZoomed,
    showControls,
    setShowControls,
    pauseAutoHideTimer,
    resetAutoHideTimer,
    handleZoomChange,
    handleToggleControls,
  } = useAutoHideTimer({
    activeImageIndex,
    filteredGalleryImages,
  });

  // iPhone Photos style Hero Expansion shared values & callbacks
  const expandProgress = useSharedValue(0);
  const thumbX = useSharedValue(0);
  const thumbY = useSharedValue(0);
  const thumbW = useSharedValue(100);
  const thumbH = useSharedValue(100);

  const mainScrollRef = useRef<ScrollView>(null);
  const cardRefs = useRef<{ [key: string]: View | null }>({});

  const registerCardRef = useCallback((cardId: string, ref: View | null) => {
    cardRefs.current[cardId] = ref;
  }, []);

  const updateThumbForIndex = useCallback((idx: number) => {
    if (idx < 0 || idx >= filteredGalleryImages.length) return;
    const img = filteredGalleryImages[idx];
    if (!img) return;
    const cardId = img.id || img.uri || `idx-${idx}`;
    const targetCard = cardRefs.current[cardId];

    if (targetCard) {
      targetCard.measureInWindow((x, y, cardWidth, cardHeight) => {
        if (cardWidth > 0 && cardHeight > 0) {
          if (y < 80 || y + cardHeight > screenHeight - 60) {
            targetCard.measureLayout(
              mainScrollRef.current as any,
              (left, top, w, h) => {
                const targetScrollY = Math.max(0, top - screenHeight / 2 + h / 2);
                mainScrollRef.current?.scrollTo({ y: targetScrollY, animated: false });
                requestAnimationFrame(() => {
                  targetCard.measureInWindow((nx, ny, nw, nh) => {
                    if (nw > 0 && nh > 0) {
                      thumbX.value = nx;
                      thumbY.value = ny;
                      thumbW.value = nw;
                      thumbH.value = nh;
                    }
                  });
                });
              },
              () => {}
            );
          } else {
            thumbX.value = x;
            thumbY.value = y;
            thumbW.value = cardWidth;
            thumbH.value = cardHeight;
          }
        }
      });
    }
  }, [filteredGalleryImages]);

  // Keep thumbnail target position updated whenever activeImageIndex changes in Lightbox
  React.useEffect(() => {
    if (activeImageIndex !== null) {
      updateThumbForIndex(activeImageIndex);
    }
  }, [activeImageIndex, updateThumbForIndex]);

  const openLightbox = useCallback((img: any, bounds: { x: number; y: number; width: number; height: number } | null) => {
    const targetIdx = filteredGalleryImages.findIndex(item => {
      if (!item || !img) return false;
      if (item === img) return true;
      if (item.id !== undefined && img.id !== undefined && item.id === img.id) return true;
      const uriItem = typeof item === 'string' ? item : item.uri;
      const uriImg = typeof img === 'string' ? img : img.uri;
      return Boolean(uriItem && uriImg && uriItem === uriImg);
    });
    const finalIdx = targetIdx !== -1 ? targetIdx : (img.originalIndex ?? 0);

    if (bounds && bounds.width > 0 && bounds.height > 0) {
      thumbX.value = bounds.x;
      thumbY.value = bounds.y;
      thumbW.value = bounds.width;
      thumbH.value = bounds.height;
    } else {
      thumbX.value = width / 2 - 60;
      thumbY.value = screenHeight / 2 - 60;
      thumbW.value = 120;
      thumbH.value = 120;
    }

    setShowControls(true);
    handleZoomChange(false);
    expandProgress.value = 0;
    setActiveImageIndex(finalIdx);

    requestAnimationFrame(() => {
      expandProgress.value = withTiming(1, {
        duration: 400,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      });
    });
  }, [filteredGalleryImages, width]);

  const closeLightbox = useCallback(() => {
    if (activeImageIndex !== null) {
      updateThumbForIndex(activeImageIndex);
    }
    expandProgress.value = withTiming(0, {
      duration: 350,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    }, (finished) => {
      if (finished) {
        runOnJS(setActiveImageIndex)(null);
      }
    });
  }, [activeImageIndex, updateThumbForIndex]);

  const heroAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    const p = expandProgress.value;
    const cx_grid = thumbX.value + thumbW.value / 2;
    const cy_grid = thumbY.value + thumbH.value / 2;
    const cx_screen = width / 2;
    const cy_screen = screenHeight / 2;

    const initialScale = Math.max(thumbW.value / width, 0.12);
    const scale = initialScale + (1 - initialScale) * p;

    const initialTx = cx_grid - cx_screen;
    const initialTy = cy_grid - cy_screen;
    const translateX = initialTx * (1 - p);
    const translateY = initialTy * (1 - p);

    return {
      opacity: p > 0.002 ? 1 : 0,
      transform: [
        { translateX },
        { translateY },
        { scale },
      ],
      borderRadius: (1 - p) * 16,
      overflow: 'hidden',
    };
  });

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: '#000000',
    opacity: expandProgress.value,
  }));

  const controlsFadeAnimatedStyle = useAnimatedStyle(() => ({
    opacity: expandProgress.value,
  }));
  // FIX 1: start at 40, bump to Infinity after 150ms
  const [renderLimit, setRenderLimit] = useState<number>(40);
  const insets = useSafeAreaInsets();

  // Reanimated shared values for smooth swipe animations (UI thread)
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const isFirstPhoto = useSharedValue(false);
  const isLastPhoto = useSharedValue(false);

  const toastTranslateY = useSharedValue(-150);
  const toastOpacity = useSharedValue(0);

  const toastAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: toastTranslateY.value }],
    opacity: toastOpacity.value,
  }));

  // Heart pop animation matching MyCircle Web page.tsx (showHeartPop state + 800ms keyframe curve)
  const [showHeartPop, setShowHeartPop] = useState(false);
  const heartPopTimeoutRef = useRef<any>(null);
  const heartPopScale = useSharedValue(0);
  const heartPopOpacity = useSharedValue(0);

  const triggerHeartPop = useCallback(() => {
    if (heartPopTimeoutRef.current) {
      clearTimeout(heartPopTimeoutRef.current);
    }
    setShowHeartPop(true);
    heartPopTimeoutRef.current = setTimeout(() => {
      setShowHeartPop(false);
    }, 800);
  }, []);

  React.useEffect(() => {
    if (showHeartPop) {
      heartPopScale.value = 0;
      heartPopOpacity.value = 0;

      heartPopOpacity.value = withSequence(
        withTiming(0.75, { duration: 120 }),
        withTiming(0.75, { duration: 520 }),
        withTiming(0, { duration: 160 })
      );

      heartPopScale.value = withSequence(
        withTiming(1.2, { duration: 120, easing: Easing.bezier(0.175, 0.885, 0.32, 1.275) }),
        withTiming(1.0, { duration: 120 }),
        withTiming(1.0, { duration: 400 }),
        withTiming(1.4, { duration: 160, easing: Easing.ease })
      );
    }
  }, [showHeartPop]);

  const heartPopAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartPopScale.value }],
    opacity: heartPopOpacity.value,
  }));

  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    pauseAutoHideTimer();
    setShowControls(true);
    setToastMessage(msg);

    toastTranslateY.value = -150;
    toastOpacity.value = 0;
    toastTranslateY.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) });
    toastOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) });

    toastTimeoutRef.current = setTimeout(() => {
      toastTranslateY.value = withTiming(-150, { duration: 220, easing: Easing.in(Easing.quad) });
      toastOpacity.value = withTiming(0, { duration: 200 });
      setTimeout(() => {
        setToastMessage(null);
        resetAutoHideTimer();
      }, 250);
    }, 2200);
  }, [pauseAutoHideTimer, resetAutoHideTimer]);

  React.useEffect(() => {
    return () => {
      if (heartPopTimeoutRef.current) clearTimeout(heartPopTimeoutRef.current);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  // Sync isLightboxOpen shared value whenever JS activeImageIndex state changes
  React.useEffect(() => {
    isLightboxOpen.value = activeImageIndex !== null;
  }, [activeImageIndex]);

  // Native iOS Left-Edge Swipe Back Gesture
  const touchStartedOnLeftEdge = useSharedValue(false);
  const screenSwipeX = useSharedValue(0);

  const handleCloseScreen = useCallback(() => {
    if (activeImageIndex !== null) {
      closeLightbox();
      return;
    }
    screenSwipeX.value = withTiming(width, { duration: 220, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) {
        runOnJS(onClose)();
      }
    });
  }, [activeImageIndex, closeLightbox, onClose, width]);

  // Android hardware back button handler
  React.useEffect(() => {
    if (!isOpen) return;
    const onBackPress = () => {
      handleCloseScreen();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [isOpen, handleCloseScreen]);

  const edgeSwipeGesture = Gesture.Pan()
    .activeOffsetX(5)
    .failOffsetY([-20, 20])
    .onBegin((e) => {
      'worklet';
      // Capture touch position immediately on touch down
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
            runOnJS(onClose)();
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

  React.useEffect(() => {
    if (isOpen) {
      setActiveTab('ALL');
      setActiveImageIndex(null);
      // Slide in from right on open
      screenSwipeX.value = width;
      screenSwipeX.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) });
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
    handleZoomChange(false);
    translateX.value = 0;
    opacity.value = 1;
  }, [activeImageIndex, handleZoomChange]);

  // High-performance background prefetching of adjacent lightbox photos (+/- 2 photos)
  React.useEffect(() => {
    if (activeImageIndex !== null && filteredGalleryImages.length > 0) {
      const urlsToPrefetch: string[] = [];
      [activeImageIndex - 1, activeImageIndex + 1, activeImageIndex + 2, activeImageIndex - 2].forEach(idx => {
        if (idx >= 0 && idx < filteredGalleryImages.length) {
          const item = filteredGalleryImages[idx];
          const fullUri = typeof item === 'object' && item.fullUri 
            ? item.fullUri 
            : (typeof item === 'object' && item.uri ? item.uri : (typeof item === 'string' ? item : null));
          if (fullUri) urlsToPrefetch.push(fullUri);
        }
      });
      if (urlsToPrefetch.length > 0) {
        Image.prefetch(urlsToPrefetch);
      }
    }
  }, [activeImageIndex, filteredGalleryImages]);

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

  const flatListRef = useRef<FlatList>(null);

  // Fires immediately when ≥50% of the next photo enters the viewport,
  // so the counter and heart update without waiting for momentum to settle.
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 });
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: any[] }) => {
    if (viewableItems.length > 0) {
      const newIdx = viewableItems[0].index;
      if (typeof newIdx === 'number') {
        setActiveImageIndex(newIdx);
      }
    }
  });

  // Stable navigate ref — always points to latest closure without recreating gestures
  const navigateRef = useRef((dir: 'next' | 'prev') => {});
  navigateRef.current = (dir: 'next' | 'prev') => {
    setActiveImageIndex(prev => {
      if (prev === null) return prev;
      const targetIdx = dir === 'next' ? (prev < filteredGalleryImages.length - 1 ? prev + 1 : prev) : (prev > 0 ? prev - 1 : prev);
      if (targetIdx !== prev) {
        flatListRef.current?.scrollToIndex({ index: targetIdx, animated: true });
      }
      return targetIdx;
    });
  };
  const navigate = useCallback((dir: 'next' | 'prev') => navigateRef.current(dir), []);

  // Stable toggleSave ref for double-tap gesture
  const toggleSaveRef = useRef(() => {});
  toggleSaveRef.current = () => {
    if (activeImageIndex === null) return;
    const currentImg = filteredGalleryImages[activeImageIndex];
    if (!currentImg) return;
    const currentUrl = typeof currentImg === 'object' && currentImg.fullUri
      ? currentImg.fullUri
      : (typeof currentImg === 'object' && currentImg.uri ? currentImg.uri : (typeof currentImg === 'string' ? currentImg : ''));
    if (!currentUrl) return;

    setSavedUrls(prev => {
      const updated = new Set(prev);
      if (updated.has(currentUrl)) {
        // Double tap again -> dislike / unsave WITHOUT animation
        updated.delete(currentUrl);
        savesService.unsavePhoto(currentUrl);
        showToast("Removed from Moodboard");
      } else {
        // Double tap first time -> like / save WITH translucent heart pop animation
        updated.add(currentUrl);
        savesService.savePhoto(currentUrl, story?.id);
        triggerHeartPop();
        showToast("Photo saved to Moodboard ✨");
      }
      return updated;
    });
  };
  const toggleSave = useCallback(() => toggleSaveRef.current(), []);



  const renderLightboxItem = useCallback(({ item }: { item: any }) => (
    <LightboxImageItem
      item={item}
      width={width}
      onDoubleTap={toggleSave}
      onNavigate={navigate}
      onZoomChange={handleZoomChange}
      onToggleControls={handleToggleControls}
      onCloseLightbox={closeLightbox}
      onInteractionStart={pauseAutoHideTimer}
      onInteractionEnd={resetAutoHideTimer}
      expandProgress={expandProgress}
      heartPopScale={heartPopScale}
      heartPopOpacity={heartPopOpacity}
    />
  ), [
    toggleSave,
    navigate,
    handleZoomChange,
    handleToggleControls,
    closeLightbox,
    pauseAutoHideTimer,
    resetAutoHideTimer,
    expandProgress,
    heartPopScale,
    heartPopOpacity,
  ]);

  if (!story) return null;

  const locationText = (story.location || '').toUpperCase();
  const titleText = story.title || '';
  const dateText = formatDateText(story.date);
  const descriptionText = story.description || '';

  return (
    <Modal
      visible={isOpen}
      animationType="none"
      transparent={true}
      presentationStyle="overFullScreen"
      onRequestClose={handleCloseScreen}
      statusBarTranslucent={true}
    >
      <GestureHandlerRootView style={styles.container}>
        <GestureDetector gesture={edgeSwipeGesture}>
          <Animated.View style={[{ flex: 1, backgroundColor: '#ffffff' }, screenSwipeAnimatedStyle]}>
            <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

            {/* Borderless Editorial Back Button */}
            <Pressable
              style={[styles.editorialBackButton, { top: Math.max(insets.top + 10, 42) }]}
              onPress={handleCloseScreen}
              hitSlop={16}
            >
              <Text style={styles.editorialBackText}>← BACK</Text>
            </Pressable>

        <ScrollView
          ref={mainScrollRef}
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
            {/* White Logo on Cover (positioned exactly where app header logo is) */}
            <View style={[styles.coverHeaderLogoContainer, { top: insets.top + 6 }]} pointerEvents="none">
              <RNImage
                source={require('../../../assets/images/logo-white.png')}
                style={styles.coverHeaderLogo}
                resizeMode="contain"
              />
            </View>
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
                      onSelect={(bounds) => openLightbox(img, bounds)}
                      onRegisterRef={registerCardRef}
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
                      onSelect={(bounds) => openLightbox(img, bounds)}
                      onRegisterRef={registerCardRef}
                    />
                  ))}
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </Animated.View>
    </GestureDetector>

        {/* ── Option 1: Minimalist Editorial Lightbox (Vogue / Kinfolk Style) ── */}
        {activeImageIndex !== null && (
          <Modal
            transparent={true}
            visible={true}
            animationType="none"
            onRequestClose={closeLightbox}
            statusBarTranslucent={true}
          >
            <GestureHandlerRootView style={{ flex: 1 }}>
              {/* Full-screen Dark Backdrop */}
              <Animated.View style={[StyleSheet.absoluteFillObject, backdropAnimatedStyle]} pointerEvents="none" />

              <View style={styles.lightboxContainer}>
                <StatusBar barStyle="light-content" translucent backgroundColor="transparent" hidden={!showControls} animated={true} />

                {/* Toast Notification Banner */}
                {toastMessage && (
                  <Animated.View style={[styles.toastBanner, { top: Math.max(insets.top + 75, 100) }, toastAnimatedStyle]} pointerEvents="none">
                    <Ionicons name="bookmark" size={14} color="#FFD700" style={{ marginRight: 8 }} />
                    <Text style={styles.toastText}>{toastMessage}</Text>
                  </Animated.View>
                )}

                {/* Top Editorial Header Gradient Overlay */}
                {showControls && (
                  <Animated.View style={[{ zIndex: 100 }, controlsFadeAnimatedStyle]} pointerEvents="box-none">
                    <LinearGradient
                      colors={['rgba(0, 0, 0, 0.45)', 'rgba(0, 0, 0, 0.1)', 'transparent']}
                      style={[styles.lightboxHeaderGradient, { paddingTop: Math.max(insets.top + 18, 54) }]}
                      pointerEvents="box-none"
                    >
                      <View style={styles.lightboxHeaderInner}>
                        {/* Left Spacer to balance close button for perfect centering */}
                        <View style={styles.headerSpacer} />

                        <View style={styles.lightboxHeaderBrand}>
                          <Text style={styles.lightboxBrandText}>MISTY VISUALS</Text>
                          <Text style={styles.lightboxBrandSub}>EDITORIAL</Text>
                        </View>
                        
                        <Pressable 
                          style={({ pressed }) => [
                            styles.lightboxCloseEditorial,
                            pressed && { opacity: 0.6 }
                          ]} 
                          onPress={closeLightbox}
                          hitSlop={14}
                          accessibilityRole="button"
                          accessibilityLabel="Close lightbox"
                          accessibilityHint="Closes the fullscreen photo viewer and returns to gallery"
                        >
                          <Text style={styles.lightboxCloseIcon}>✕</Text>
                        </Pressable>
                      </View>
                    </LinearGradient>
                  </Animated.View>
                )}

                {/* Native Horizontal Paging Lightbox Stage -- ONLY THE PHOTO EXPANDS! */}
                <Animated.View style={[{ flex: 1, justifyContent: 'center', alignItems: 'center' }, heroAnimatedStyle]}>
                  <View style={styles.lightboxImageContainer}>
                    <FlatList
                      ref={flatListRef}
                      data={filteredGalleryImages}
                      horizontal
                      disableIntervalMomentum={true}
                      decelerationRate="fast"
                      snapToInterval={width + 18}
                      snapToAlignment="start"
                      scrollEnabled={!isZoomed}
                      showsHorizontalScrollIndicator={false}
                      initialScrollIndex={activeImageIndex ?? 0}
                      windowSize={3}
                      maxToRenderPerBatch={2}
                      initialNumToRender={1}
                      getItemLayout={(data, index) => ({
                        length: width + 18,
                        offset: (width + 18) * index,
                        index,
                      })}
                      onScrollBeginDrag={() => {
                        setShowControls(true);
                        pauseAutoHideTimer();
                      }}
                      onMomentumScrollEnd={() => {
                        resetAutoHideTimer();
                      }}
                      viewabilityConfig={viewabilityConfig.current}
                      onViewableItemsChanged={onViewableItemsChanged.current}
                      keyExtractor={(item, index) => item.id || `lightbox-${index}`}
                      ItemSeparatorComponent={() => <View style={{ width: 18, backgroundColor: '#000000' }} />}
                      renderItem={renderLightboxItem}
                    />
                  </View>
                </Animated.View>

                {/* Bottom Editorial Footer Gradient Overlay */}
                {showControls && (
                  <Animated.View style={[{ zIndex: 100 }, controlsFadeAnimatedStyle]} pointerEvents="box-none">
                    <LinearGradient
                      colors={['transparent', 'rgba(0, 0, 0, 0.4)', 'rgba(0, 0, 0, 0.85)']}
                      style={[styles.lightboxFooterGradient, { paddingBottom: Math.max(insets.bottom, 24) + 8 }]}
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
                            try {
                              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            } catch {
                              // Ignore if haptics unavailable
                            }
                            const updated = new Set(savedUrls);
                            updated.delete(currentUrlForSave);
                            setSavedUrls(updated);
                            showToast("Removed from Moodboard");
                            await savesService.unsavePhoto(currentUrlForSave);
                          } else {
                            try {
                              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            } catch {
                              // Ignore if haptics unavailable
                            }
                            const updated = new Set(savedUrls);
                            updated.add(currentUrlForSave);
                            setSavedUrls(updated);
                            triggerHeartPop();
                            showToast("Photo saved to Moodboard ✨");
                            await savesService.savePhoto(currentUrlForSave, story?.id);
                          }
                        };

                        const handleShareCurrentPhoto = async () => {
                          if (!currentUrlForSave) return;
                          try {
                            await Share.share({
                              message: `Check out this photo from ${story?.title || 'Misty Visuals'}:\n${currentUrlForSave}`,
                              url: currentUrlForSave,
                              title: story?.title || 'Misty Visuals',
                            });
                          } catch (error) {
                            console.warn('Error sharing photo:', error);
                          }
                        };

                        const displayTitle = (story?.title || '')
                          .replace(/'s\s+Wedding/gi, '')
                          .trim()
                          .toUpperCase();
                        const categoryName = (typeof currentImgForSave === 'object' && currentImgForSave && currentImgForSave.category)
                          ? String(currentImgForSave.category).toUpperCase()
                          : null;
                        const titleLabel = categoryName ? `${displayTitle}  ·  ${categoryName}` : displayTitle;

                        return (
                          <View style={{ alignItems: 'center', width: '100%' }}>
                            {/* High-Fashion Format Counter: e.g. "01 // 24" */}
                            <View 
                              style={styles.lightboxCounterContainer}
                              accessible={true}
                              accessibilityRole="text"
                              accessibilityLabel={`Photo ${activeImageIndex !== null ? activeImageIndex + 1 : 1} of ${filteredGalleryImages.length}`}
                            >
                              <Text style={styles.lightboxCounterCurrent}>
                                {String(activeImageIndex !== null ? activeImageIndex + 1 : 1).padStart(2, '0')}
                              </Text>
                              <Text style={styles.lightboxCounterDivider}>//</Text>
                              <Text style={styles.lightboxCounterTotal}>
                                {String(filteredGalleryImages.length).padStart(2, '0')}
                              </Text>
                            </View>

                            {/* Couple Name / Title / Category Tab */}
                            {titleLabel ? (
                              <Text style={styles.lightboxCategoryText}>{titleLabel}</Text>
                            ) : null}

                            {/* Bottom Actions Row: Thin Feather Heart & Share icons */}
                            <View style={styles.lightboxActionRow}>
                              <Pressable
                                style={({ pressed }) => [
                                  styles.lightboxIconOnlyBtn,
                                  pressed && { opacity: 0.6 }
                                ]}
                                onPress={handleToggleCurrentPhotoSave}
                                hitSlop={14}
                              >
                                <Ionicons 
                                  name={isCurrentPhotoSaved ? 'heart' : 'heart-outline'} 
                                  size={21} 
                                  color={isCurrentPhotoSaved ? '#ef4444' : '#ffffff'} 
                                />
                              </Pressable>

                              <Pressable
                                style={({ pressed }) => [
                                  styles.lightboxIconOnlyBtn,
                                  pressed && { opacity: 0.6 }
                                ]}
                                onPress={handleShareCurrentPhoto}
                                hitSlop={14}
                              >
                                <Feather 
                                  name="share-2" 
                                  size={19} 
                                  color="#ffffff" 
                                />
                              </Pressable>
                            </View>
                          </View>
                        );
                      })()}
                    </LinearGradient>
                  </Animated.View>
                )}
              </View>
            </GestureHandlerRootView>
          </Modal>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
    backgroundColor: 'transparent',
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
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerSpacer: {
    width: 34,
    height: 34,
  },
  lightboxHeaderBrand: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  lightboxBrandText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12,
    letterSpacing: 3.5,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
  },
  lightboxBrandSub: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 9,
    letterSpacing: 4.5,
    color: 'rgba(255, 255, 255, 0.4)',
    fontWeight: '500',
  },
  lightboxCloseEditorial: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxCloseIcon: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 14,
    lineHeight: 14,
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
  lightboxActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginTop: 6,
  },
  lightboxIconOnlyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxHeartIcon: {
    fontSize: 22,
    lineHeight: 22,
  },
  lightboxShareIcon: {
    fontSize: 18,
    lineHeight: 18,
    color: '#ffffff',
  },
  heartPopContainer: {
    position: 'absolute',
    zIndex: 999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heartPopShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 10,
  },
  toastBanner: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(20, 20, 20, 0.92)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1000,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONT_JOST_MEDIUM,
    letterSpacing: 0.2,
  },
});
