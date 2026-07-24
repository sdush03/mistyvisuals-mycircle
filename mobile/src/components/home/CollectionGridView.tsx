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

export interface CollectionItem {
  id: string | number;
  title: string;
  category?: string;
  location?: string;
  subtext?: string;
  coverImage?: any;
  rawItem: any;
}

interface CollectionGridViewProps {
  isOpen: boolean;
  onClose: () => void;
  headerTitle: string;
  sectionHeadingPrefix?: string;
  items: CollectionItem[];
  initialCategory?: string;
  onSelectItem: (item: CollectionItem) => void;
}

export default function CollectionGridView({
  isOpen,
  onClose,
  headerTitle,
  sectionHeadingPrefix = 'COLLECTIONS',
  items,
  initialCategory = 'All',
  onSelectItem,
}: CollectionGridViewProps) {
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);

  const translateX = useSharedValue(0);
  const touchStartX = useSharedValue(0);
  const isSwipeFromEdge = useSharedValue(false);

  React.useEffect(() => {
    if (isOpen) {
      translateX.value = 0;
      setSelectedCategory(initialCategory || 'All');
    }
  }, [isOpen, initialCategory]);

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

  // Dynamic Category filters
  const categories = React.useMemo(() => {
    const categoriesSet = new Set<string>();
    items.forEach((item) => {
      const cats = (item.category || '').split(',').map((c) => c.trim()).filter(Boolean);
      cats.forEach((c) => categoriesSet.add(c));
    });
    if (categoriesSet.size === 0) return ['All'];
    return ['All', ...Array.from(categoriesSet).sort()];
  }, [items]);

  const filteredItems = React.useMemo(() => {
    if (selectedCategory === 'All') return items;
    const catLower = selectedCategory.toLowerCase();
    return items.filter((item) => {
      const dbCategories = (item.category || '').split(',').map((c) => c.trim().toLowerCase());
      if (dbCategories.includes(catLower)) return true;
      const title = (item.title || '').toLowerCase();
      const loc = (item.location || '').toLowerCase();
      return title.includes(catLower) || loc.includes(catLower);
    });
  }, [items, selectedCategory]);

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
              <Text style={styles.headerTitle}>{headerTitle.toUpperCase()}</Text>
              <View style={{ width: 60 }} />
            </View>

            {/* Category Filter Pills */}
            {categories.length > 1 && (
              <View style={styles.vibeBarContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vibeScroll}>
                  {categories.map((cat) => {
                    const active = cat === selectedCategory;
                    return (
                      <Pressable
                        key={cat}
                        style={[styles.vibePill, active && styles.vibePillActive]}
                        onPress={() => setSelectedCategory(cat)}
                      >
                        <Text style={[styles.vibeText, active && styles.vibeTextActive]}>{cat}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Grid Content */}
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>
                  {selectedCategory === 'All'
                    ? `ALL ${sectionHeadingPrefix.toUpperCase()}`
                    : `${selectedCategory.toUpperCase()} ${sectionHeadingPrefix.toUpperCase()}`}
                </Text>
                <Text style={styles.countText}>{filteredItems.length} ITEMS</Text>
              </View>

              {filteredItems.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No items found under "{selectedCategory}".</Text>
                </View>
              ) : (
                <View style={styles.grid}>
                  {filteredItems.map((item) => {
                    const formattedTitle = (item.title || '')
                      .split(' ')
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                      .join(' ');
                    const imageSource = item.coverImage
                      ? typeof item.coverImage === 'string'
                        ? { uri: item.coverImage }
                        : item.coverImage
                      : null;

                    return (
                      <Pressable
                        key={item.id}
                        style={styles.card}
                        onPress={() => onSelectItem(item)}
                      >
                        {imageSource ? (
                          <Image source={imageSource} style={styles.cover} />
                        ) : (
                          <View style={[styles.cover, { backgroundColor: '#18181b' }]} />
                        )}
                        <LinearGradient
                          colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.88)']}
                          locations={[0, 0.45, 1]}
                          style={styles.overlay}
                        />
                        <View style={styles.info}>
                          {item.category ? (
                            <Text style={styles.category} numberOfLines={1}>
                              {item.category.toUpperCase()}
                            </Text>
                          ) : null}
                          <Text style={styles.title} numberOfLines={1}>
                            {formattedTitle}
                          </Text>
                          <View style={styles.bottomRow}>
                            <Text style={styles.subtext} numberOfLines={1}>
                              {item.subtext || item.location || 'Collection'}
                            </Text>
                            <Text style={styles.ctaText}>View →</Text>
                          </View>
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
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
    backgroundColor: '#ffffff',
  },
  backButton: {
    paddingVertical: 6,
    paddingRight: 12,
  },
  backText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#1c1a18',
  },
  headerTitle: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    letterSpacing: 2.5,
    color: '#1c1a18',
    textAlign: 'center',
  },
  vibeBarContainer: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
    backgroundColor: '#fbfaf8',
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
    borderColor: '#e8e4de',
    backgroundColor: '#ffffff',
  },
  vibePillActive: {
    backgroundColor: '#1c1a18',
    borderColor: '#1c1a18',
  },
  vibeText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    color: '#60646c',
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
    color: '#8c867e',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  card: {
    width: (width - 54) / 2,
    height: 240,
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1c1a18',
  },
  cover: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  info: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
  },
  category: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 8.5,
    letterSpacing: 1.8,
    color: '#a07850',
    marginBottom: 4,
  },
  title: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 2,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  subtext: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10.5,
    color: '#e5dfd5',
    flex: 1,
    marginRight: 6,
  },
  ctaText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10.5,
    letterSpacing: 0.5,
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
