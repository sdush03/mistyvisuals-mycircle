import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  ScrollView,
  Image,
  Pressable,
  Dimensions,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import {
  FONT_MONTSERRAT_REGULAR,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';

const { width } = Dimensions.get('window');

interface AllStoriesViewProps {
  isOpen: boolean;
  onClose: () => void;
  stories: any[];
  initialVibe?: string;
  onSelectStory: (story: any) => void;
}

export default function AllStoriesView({
  isOpen,
  onClose,
  stories,
  initialVibe = 'All',
  onSelectStory,
}: AllStoriesViewProps) {
  const insets = useSafeAreaInsets();
  const [selectedVibe, setSelectedVibe] = useState(initialVibe);

  const translateX = useSharedValue(0);
  const touchStartX = useSharedValue(0);
  const isSwipeFromEdge = useSharedValue(false);

  React.useEffect(() => {
    if (isOpen) {
      translateX.value = 0;
    }
  }, [isOpen]);

  // iOS native-feel Edge Swipe Back gesture (swipe right from left 65px edge)
  const edgeSwipeGesture = Gesture.Pan()
    .onBegin((e) => {
      'worklet';
      if (e.x <= 65) {
        touchStartX.value = e.x;
        isSwipeFromEdge.value = true;
      } else {
        isSwipeFromEdge.value = false;
      }
    })
    .activeOffsetX(5)
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      'worklet';
      if (isSwipeFromEdge.value && e.translationX > 0) {
        translateX.value = e.translationX;
      }
    })
    .onEnd((e) => {
      'worklet';
      if (isSwipeFromEdge.value) {
        if (e.translationX > 100 || e.velocityX > 500) {
          translateX.value = withTiming(width, { duration: 200 }, () => {
            runOnJS(onClose)();
          });
        } else {
          translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
        }
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Android hardware back button handler
  React.useEffect(() => {
    if (!isOpen) return;
    const onBackPress = () => {
      onClose();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [isOpen, onClose]);

  React.useEffect(() => {
    if (isOpen && initialVibe) {
      setSelectedVibe(initialVibe);
    }
  }, [isOpen, initialVibe]);

  // Dynamic Vibe filters
  const vibeFilters = React.useMemo(() => {
    const categoriesSet = new Set<string>();
    stories.forEach((s: any) => {
      const cats = (s.category || '').split(',').map((c: string) => c.trim()).filter(Boolean);
      cats.forEach((c: string) => categoriesSet.add(c));
    });
    if (categoriesSet.size === 0) return ['All', 'Destination', 'Intimate', 'Luxury', 'Traditional'];
    return ['All', ...Array.from(categoriesSet).sort()];
  }, [stories]);

  const filteredStories = React.useMemo(() => {
    if (selectedVibe === 'All') return stories;
    const v = selectedVibe.toLowerCase();
    return stories.filter((s: any) => {
      const dbCategories = (s.category || '').split(',').map((c: string) => c.trim().toLowerCase());
      if (dbCategories.includes(v)) return true;
      const title = (s.title || '').toLowerCase();
      const sub = (s.subtitle || '').toLowerCase();
      const loc = (s.location || '').toLowerCase();
      return title.includes(v) || sub.includes(v) || loc.includes(v);
    });
  }, [stories, selectedVibe]);

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <GestureDetector gesture={edgeSwipeGesture}>
          <Animated.View style={[styles.container, animatedStyle]}>
            {/* Top Navigation Bar */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
              <Pressable style={styles.backButton} onPress={onClose}>
                <Text style={styles.backText}>← BACK</Text>
              </Pressable>
              <Text style={styles.headerTitle}>WEDDING STORIES</Text>
              <View style={{ width: 60 }} />
            </View>

            {/* Vibe Filter Pills */}
            <View style={styles.vibeBarContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vibeScroll}>
                {vibeFilters.map((vibe) => {
                  const active = vibe === selectedVibe;
                  return (
                    <Pressable
                      key={vibe}
                      style={[styles.vibePill, active && styles.vibePillActive]}
                      onPress={() => setSelectedVibe(vibe)}
                    >
                      <Text style={[styles.vibeText, active && styles.vibeTextActive]}>{vibe}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Grid Content */}
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>
                  {selectedVibe === 'All' ? 'ALL STORIES' : `${selectedVibe.toUpperCase()} STORIES`}
                </Text>
                <Text style={styles.countText}>{filteredStories.length} COLLECTIONS</Text>
              </View>

              {filteredStories.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No stories found under "{selectedVibe}".</Text>
                </View>
              ) : (
                <View style={styles.storiesGrid}>
                  {filteredStories.map((story) => {
                    const coverUri = story.cover_image_mobile_url || story.cover_image_url || story.grid_image_url || (typeof story.coverImage === 'string' ? story.coverImage : story.coverImage?.uri);
                    const imageSource = coverUri ? { uri: coverUri } : undefined;
                    return (
                      <Pressable
                        key={story.id}
                        style={styles.storyCard}
                        onPress={() => {
                          onClose();
                          onSelectStory(story);
                        }}
                      >
                        {imageSource ? (
                          <Image source={imageSource} style={styles.storyCover} />
                        ) : (
                          <View style={[styles.storyCover, { backgroundColor: '#18181b' }]} />
                        )}
                        <LinearGradient
                          colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.88)']}
                          locations={[0, 0.45, 1]}
                          style={styles.storyOverlay}
                        />
                        <View style={styles.storyInfo}>
                          <Text style={styles.storyCategory}>{(story.category || 'WEDDING').toUpperCase()}</Text>
                          <Text style={styles.storyTitle} numberOfLines={1}>{story.title}</Text>
                          {story.location ? <Text style={styles.storyLocation} numberOfLines={1}>{story.location}</Text> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#12100e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#24211e',
    backgroundColor: 'rgba(18, 16, 14, 0.96)',
  },
  backButton: {
    paddingVertical: 6,
    paddingRight: 12,
  },
  backText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#d0c8be',
  },
  headerTitle: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    letterSpacing: 2.5,
    color: '#9a7d52',
    textAlign: 'center',
  },
  vibeBarContainer: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#24211e',
    backgroundColor: '#161412',
  },
  vibeScroll: {
    paddingHorizontal: 20,
    gap: 8,
  },
  vibePill: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2d2925',
    backgroundColor: '#1c1a18',
  },
  vibePillActive: {
    backgroundColor: '#9a7d52',
    borderColor: '#9a7d52',
  },
  vibeText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    color: '#a0988e',
  },
  vibeTextActive: {
    color: '#ffffff',
    fontFamily: FONT_JOST_SEMIBOLD,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 60,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionHeading: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    letterSpacing: 2.5,
    color: '#9a7d52',
  },
  countText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10,
    letterSpacing: 1,
    color: '#7a756d',
  },
  storiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  storyCard: {
    width: (width - 54) / 2,
    height: 230,
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1c1a18',
  },
  storyCover: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  storyOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  storyInfo: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
  },
  storyCategory: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 8.5,
    letterSpacing: 1.8,
    color: '#a07850',
    marginBottom: 4,
  },
  storyTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 2,
  },
  storyLocation: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10,
    color: '#d0c8be',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    color: '#8c867e',
  },
});
