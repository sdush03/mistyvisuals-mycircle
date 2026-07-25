import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  Dimensions,
  Share,
  StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LightboxImageItem } from './components/LightboxImageItem';
import { savesService } from '../../../services/savesService';
import {
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_SEMIBOLD,
} from '../../../constants/fonts';

const { width, height } = Dimensions.get('window');

interface FeaturedStoryLightboxModalProps {
  visible: boolean;
  images: any[];
  initialIndex: number;
  onClose: () => void;
  onUnsave?: (item: any) => void;
  title?: string;
}

export default function FeaturedStoryLightboxModal({
  visible,
  images,
  initialIndex,
  onClose,
  onUnsave,
  title = 'MY MOODBOARD',
}: FeaturedStoryLightboxModalProps) {
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);

  const [activeIdx, setActiveIdx] = useState<number>(initialIndex);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isZoomed, setIsZoomed] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());

  // Shared Values for Animations
  const expandProgress = useSharedValue(1);
  const backdropOpacity = useSharedValue(1);
  const controlsOpacity = useSharedValue(1);
  const toastOpacity = useSharedValue(0);
  const heartPopScale = useSharedValue(0);
  const heartPopOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setActiveIdx(initialIndex);
      expandProgress.value = 1;
      backdropOpacity.value = 1;
      controlsOpacity.value = 1;
      
      // Load current saved URLs state
      savesService.getSavedPhotos().then((items) => {
        const urls = new Set(items.map((i) => i.photoUrl));
        setSavedUrls(urls);
      });
    }
  }, [visible, initialIndex]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    toastOpacity.value = withTiming(1, { duration: 250 });
    setTimeout(() => {
      toastOpacity.value = withTiming(0, { duration: 300 });
      setTimeout(() => setToastMsg(null), 300);
    }, 1800);
  }, [toastOpacity]);

  const triggerHeartPop = useCallback(() => {
    heartPopScale.value = 0.4;
    heartPopOpacity.value = 1;
    heartPopScale.value = withSpring(1.2, { damping: 10, stiffness: 200 }, () => {
      heartPopOpacity.value = withTiming(0, { duration: 350 });
    });
  }, [heartPopScale, heartPopOpacity]);

  const handleClose = useCallback(() => {
    expandProgress.value = withTiming(0, { duration: 220 }, () => {
      onClose();
    });
  }, [expandProgress, onClose]);

  const currentItem = images[activeIdx] || null;
  const currentUrl = currentItem
    ? (typeof currentItem === 'string'
        ? currentItem
        : currentItem.photoUrl || currentItem.url || currentItem.r2Url || currentItem.file_url_mobile || '')
    : '';

  const isSaved = savedUrls.has(currentUrl);

  const handleToggleSave = async () => {
    if (!currentUrl) return;
    if (isSaved) {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
      const updated = new Set(savedUrls);
      updated.delete(currentUrl);
      setSavedUrls(updated);
      showToast('Removed from Moodboard');
      await savesService.unsavePhoto(currentUrl, currentItem?.id);
      if (onUnsave && currentItem) {
        onUnsave(currentItem);
      }
    } else {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
      const updated = new Set(savedUrls);
      updated.add(currentUrl);
      setSavedUrls(updated);
      triggerHeartPop();
      showToast('Photo saved to Moodboard ✨');
      await savesService.savePhoto(currentUrl);
    }
  };

  const handleShare = async () => {
    if (!currentUrl) return;
    try {
      await Share.share({
        message: `Check out this photo from ${title}:\n${currentUrl}`,
        url: currentUrl,
        title: title,
      });
    } catch (e) {
      console.warn('Share failed:', e);
    }
  };

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: '#000000',
    opacity: backdropOpacity.value,
  }));

  const controlsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  const toastAnimatedStyle = useAnimatedStyle(() => ({
    opacity: toastOpacity.value,
  }));

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <LightboxImageItem
        item={item}
        width={width}
        onDoubleTap={handleToggleSave}
        onNavigate={(dir) => {
          if (dir === 'next' && activeIdx < images.length - 1) {
            flatListRef.current?.scrollToIndex({ index: activeIdx + 1, animated: true });
          } else if (dir === 'prev' && activeIdx > 0) {
            flatListRef.current?.scrollToIndex({ index: activeIdx - 1, animated: true });
          }
        }}
        onZoomChange={(zoomed) => setIsZoomed(zoomed)}
        onToggleControls={() => {
          setShowControls((prev) => !prev);
          controlsOpacity.value = withTiming(showControls ? 0 : 1, { duration: 200 });
        }}
        onCloseLightbox={handleClose}
        onInteractionStart={() => {}}
        onInteractionEnd={() => {}}
        expandProgress={expandProgress}
        heartPopScale={heartPopScale}
        heartPopOpacity={heartPopOpacity}
      />
    ),
    [activeIdx, images.length, showControls, handleClose, handleToggleSave]
  );

  if (!visible || images.length === 0) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFillObject, backdropAnimatedStyle]} pointerEvents="none" />

        <View style={styles.container}>
          <StatusBar barStyle="light-content" translucent backgroundColor="transparent" animated />

          {/* Toast Notification Banner */}
          {toastMsg && (
            <Animated.View
              style={[styles.toastBanner, { top: Math.max(insets.top + 60, 80) }, toastAnimatedStyle]}
              pointerEvents="none"
            >
              <Ionicons name="bookmark" size={14} color="#FFD700" style={{ marginRight: 8 }} />
              <Text style={styles.toastText}>{toastMsg}</Text>
            </Animated.View>
          )}

          {/* Top Editorial Header Gradient */}
          {showControls && (
            <Animated.View style={[{ zIndex: 100 }, controlsAnimatedStyle]} pointerEvents="box-none">
              <LinearGradient
                colors={['rgba(0, 0, 0, 0.6)', 'rgba(0, 0, 0, 0.15)', 'transparent']}
                style={[styles.headerGradient, { paddingTop: Math.max(insets.top + 14, 44) }]}
                pointerEvents="box-none"
              >
                <View style={styles.headerInner}>
                  <View style={styles.headerSpacer} />
                  <View style={styles.headerBrand}>
                    <Text style={styles.brandTitle}>MISTY VISUALS</Text>
                    <Text style={styles.brandSub}>EDITORIAL</Text>
                  </View>
                  <Pressable style={styles.closeBtn} onPress={handleClose} hitSlop={14}>
                    <Text style={styles.closeIcon}>✕</Text>
                  </Pressable>
                </View>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Horizontal Paging Stage */}
          <View style={styles.imageStage}>
            <FlatList
              ref={flatListRef}
              data={images}
              horizontal
              pagingEnabled
              decelerationRate="fast"
              snapToInterval={width}
              scrollEnabled={!isZoomed}
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={initialIndex}
              getItemLayout={(_data, index) => ({
                length: width,
                offset: width * index,
                index,
              })}
              onMomentumScrollEnd={(e) => {
                const nextIdx = Math.round(e.nativeEvent.contentOffset.x / width);
                if (nextIdx >= 0 && nextIdx < images.length) {
                  setActiveIdx(nextIdx);
                }
              }}
              keyExtractor={(item, index) => item.id || `lightbox-${index}`}
              renderItem={renderItem}
            />
          </View>

          {/* Bottom Editorial Footer */}
          {showControls && (
            <Animated.View style={[{ zIndex: 100 }, controlsAnimatedStyle]} pointerEvents="box-none">
              <LinearGradient
                colors={['transparent', 'rgba(0, 0, 0, 0.4)', 'rgba(0, 0, 0, 0.85)']}
                style={[styles.footerGradient, { paddingBottom: Math.max(insets.bottom, 24) + 8 }]}
                pointerEvents="box-none"
              >
                <View style={{ alignItems: 'center', width: '100%' }}>
                  {/* High-Fashion Counter: e.g. "01 // 15" */}
                  <View style={styles.counterContainer}>
                    <Text style={styles.counterCurrent}>
                      {String(activeIdx + 1).padStart(2, '0')}
                    </Text>
                    <Text style={styles.counterDivider}>//</Text>
                    <Text style={styles.counterTotal}>
                      {String(images.length).padStart(2, '0')}
                    </Text>
                  </View>

                  <Text style={styles.categoryText}>{title.toUpperCase()}</Text>

                  {/* Actions Row */}
                  <View style={styles.actionRow}>
                    <Pressable style={styles.iconBtn} onPress={handleToggleSave} hitSlop={14}>
                      <Ionicons
                        name={isSaved ? 'heart' : 'heart-outline'}
                        size={22}
                        color={isSaved ? '#ef4444' : '#ffffff'}
                      />
                    </Pressable>

                    <Pressable style={styles.iconBtn} onPress={handleShare} hitSlop={14}>
                      <Ionicons name="share-outline" size={22} color="#ffffff" />
                    </Pressable>
                  </View>
                </View>
              </LinearGradient>
            </Animated.View>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  toastBanner: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(20, 20, 20, 0.92)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 200,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  toastText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 48,
  },
  headerSpacer: {
    width: 32,
  },
  headerBrand: {
    alignItems: 'center',
  },
  brandTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontFamily: FONT_FUTURA_BOLD,
    letterSpacing: 3,
  },
  brandSub: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 7,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 2,
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '300',
  },
  imageStage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 40,
    paddingHorizontal: 20,
    zIndex: 100,
  },
  counterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  counterCurrent: {
    fontSize: 13,
    fontFamily: FONT_FUTURA_BOLD,
    color: '#ffffff',
    letterSpacing: 1,
  },
  counterDivider: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_REGULAR,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  counterTotal: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_REGULAR,
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 1,
  },
  categoryText: {
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 2,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 28,
  },
  iconBtn: {
    padding: 6,
  },
});
