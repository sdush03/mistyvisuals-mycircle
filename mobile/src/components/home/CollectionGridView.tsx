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
  FONT_MONTSERRAT_LIGHT,
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
  horizontalCoverImage?: any;
  rawItem: any;
}

interface CollectionGridViewProps {
  isOpen: boolean;
  onClose: () => void;
  headerTitle: string;
  headerDescription?: string;
  sectionHeadingPrefix?: string;
  items: CollectionItem[];
  initialCategory?: string;
  onSelectItem: (item: CollectionItem) => void;
}

export default function CollectionGridView({
  isOpen,
  onClose,
  headerTitle,
  headerDescription,
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

  React.useEffect(() => {
    if (isOpen) {
      translateX.value = 0;
      if (initialCategory && initialCategory !== 'All') {
        const found = categories.find((c) => c.toLowerCase() === initialCategory.toLowerCase());
        setSelectedCategory(found || initialCategory);
      } else {
        setSelectedCategory('All');
      }
    }
  }, [isOpen, initialCategory, categories]);

  // Generate visual Category Cards for the "All" view mode with priority cover deduplication
  const categoryCards = React.useMemo(() => {
    const validCategories = categories.filter((c) => c !== 'All');

    const categoryList = validCategories.map((catName) => {
      const catLower = catName.toLowerCase();
      const catItems = items.filter((item) => {
        const dbCategories = (item.category || '').split(',').map((c) => c.trim().toLowerCase());
        if (dbCategories.includes(catLower)) return true;
        const title = (item.title || '').toLowerCase();
        const loc = (item.location || '').toLowerCase();
        return title.includes(catLower) || loc.includes(catLower);
      });
      return { name: catName, count: catItems.length, items: catItems };
    });

    const sortedCategories = [...categoryList].sort((a, b) => a.count - b.count);
    const assignedCoversMap = new Map<string, any>();
    const usedCoverUris = new Set<string>();

    sortedCategories.forEach((cat) => {
      let chosenCoverSrc: any = null;
      let chosenUriKey: string | null = null;

      for (const item of cat.items) {
        const coverUri = item.coverImage || item.horizontalCoverImage;
        const coverSrc = coverUri ? (typeof coverUri === 'string' ? { uri: coverUri } : coverUri) : null;
        const uriKey = typeof coverSrc === 'object' && coverSrc?.uri ? coverSrc.uri : (typeof coverSrc === 'string' ? coverSrc : null);

        if (coverSrc && uriKey && !usedCoverUris.has(uriKey)) {
          chosenCoverSrc = coverSrc;
          chosenUriKey = uriKey;
          break;
        }
      }

      if (!chosenCoverSrc && cat.items.length > 0) {
        const firstItem = cat.items[0];
        const coverUri = firstItem.coverImage || firstItem.horizontalCoverImage;
        chosenCoverSrc = coverUri ? (typeof coverUri === 'string' ? { uri: coverUri } : coverUri) : null;
        chosenUriKey = typeof chosenCoverSrc === 'object' && chosenCoverSrc?.uri ? chosenCoverSrc.uri : (typeof chosenCoverSrc === 'string' ? chosenCoverSrc : null);
      }

      if (chosenUriKey) {
        usedCoverUris.add(chosenUriKey);
      }
      assignedCoversMap.set(cat.name, chosenCoverSrc);
    });

    return categoryList.map((cat) => {
      const formattedTitle = cat.name
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
      const subtext = cat.count > 0 ? `${cat.count} ${cat.count === 1 ? 'Collection' : 'Collections'} →` : 'Explore Category →';

      return {
        name: cat.name,
        title: formattedTitle,
        count: cat.count,
        subtext,
        coverImage: assignedCoversMap.get(cat.name) || null,
      };
    });
  }, [categories, items]);

  const handleBackPress = React.useCallback(() => {
    if (selectedCategory !== 'All' && categoryCards.length > 0) {
      setSelectedCategory('All');
    } else {
      onClose();
    }
  }, [selectedCategory, categoryCards, onClose]);

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
            runOnJS(handleBackPress)();
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
      handleBackPress();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [isOpen, handleBackPress]);

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

  const currentDisplayTitle = React.useMemo(() => {
    if (selectedCategory === 'All' || !selectedCategory) {
      return headerTitle;
    }
    return selectedCategory
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }, [selectedCategory, headerTitle]);

  const featuredItem = filteredItems.length > 0 ? filteredItems[0] : null;
  const gridItems = filteredItems.length > 1 ? filteredItems.slice(1) : (filteredItems.length === 1 ? [] : []);

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
            {/* Clean Top Header Bar */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
              <Pressable style={styles.backButton} onPress={handleBackPress}>
                <Text style={styles.backIcon}>←</Text>
              </Pressable>
              <Image
                source={require('@/assets/images/logo-black.png')}
                style={styles.headerLogo}
                resizeMode="contain"
              />
              <View style={{ width: 40 }} />
            </View>

            {/* Main Content Area */}
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {/* Centered Editorial Title & Description Banner */}
              <View style={styles.titleSection}>
                <Text style={styles.bannerTitle}>{currentDisplayTitle}</Text>
                {headerDescription ? (
                  <Text style={styles.bannerDescription}>{headerDescription}</Text>
                ) : null}
              </View>

              {filteredItems.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No items found under "{selectedCategory}".</Text>
                </View>
              ) : selectedCategory === 'All' && categoryCards.length > 0 ? (
                /* Categories Overview Grid View */
                <View style={styles.gridSection}>
                  <View style={styles.grid}>
                    {categoryCards.map((catCard) => (
                      <Pressable
                        key={catCard.name}
                        style={styles.card}
                        onPress={() => setSelectedCategory(catCard.name)}
                      >
                        {catCard.coverImage ? (
                          <Image
                            source={
                              typeof catCard.coverImage === 'string'
                                ? { uri: catCard.coverImage }
                                : catCard.coverImage
                            }
                            style={styles.cover}
                          />
                        ) : (
                          <View style={[styles.cover, { backgroundColor: '#18181b' }]} />
                        )}
                        <LinearGradient
                          colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.88)']}
                          locations={[0, 0.45, 1]}
                          style={styles.overlay}
                        />
                        <View style={styles.info}>
                          <Text style={styles.title} numberOfLines={1}>
                            {catCard.title}
                          </Text>
                          <Text style={styles.subtext} numberOfLines={1}>
                            {catCard.subtext}
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : (
                <>
                  {/* FEATURED Section */}
                  {featuredItem && (
                    <View style={styles.featuredSection}>
                      <Pressable
                        style={styles.featuredCard}
                        onPress={() => onSelectItem(featuredItem)}
                      >
                        {(featuredItem.horizontalCoverImage || featuredItem.coverImage) ? (
                          <Image
                            source={
                              typeof (featuredItem.horizontalCoverImage || featuredItem.coverImage) === 'string'
                                ? { uri: featuredItem.horizontalCoverImage || featuredItem.coverImage }
                                : (featuredItem.horizontalCoverImage || featuredItem.coverImage)
                            }
                            style={styles.featuredCover}
                          />
                        ) : (
                          <View style={[styles.featuredCover, { backgroundColor: '#18181b' }]} />
                        )}
                        <LinearGradient
                          colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.88)']}
                          locations={[0, 0.4, 1]}
                          style={styles.overlay}
                        />

                        <View style={styles.featuredInfo}>
                          <Text style={styles.featuredTitle} numberOfLines={1}>
                            {(featuredItem.title || '')
                              .split(' ')
                              .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                              .join(' ')}
                          </Text>
                          <Text style={styles.featuredSubtext} numberOfLines={1}>
                            {featuredItem.subtext || featuredItem.location || 'Collection'}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  )}

                  {/* ALL COLLECTIONS Grid Section */}
                  <View style={styles.gridSection}>
                    <View style={styles.grid}>
                      {(gridItems.length > 0 ? gridItems : (featuredItem ? [] : filteredItems)).map((item) => {
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
                              <Text style={styles.title} numberOfLines={2}>
                                {formattedTitle}
                              </Text>
                              <Text style={styles.subtext} numberOfLines={1}>
                                {item.subtext || item.location || 'Collection'}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </>
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
    paddingBottom: 10,
    backgroundColor: '#ffffff',
  },
  backButton: {
    paddingVertical: 6,
    paddingRight: 16,
  },
  backIcon: {
    fontSize: 20,
    color: '#1c1a18',
    fontWeight: '300',
  },
  headerLogo: {
    height: 38,
    width: 135,
    tintColor: '#000000',
  },
  scrollContent: {
    paddingBottom: 60,
  },
  titleSection: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 12,
    paddingBottom: 18,
  },
  bannerTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 32,
    color: '#1c1a18',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  bannerDescription: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    lineHeight: 19,
    color: '#7a756d',
    textAlign: 'center',
  },
  backToCategoriesLink: {
    alignSelf: 'center',
    marginBottom: 20,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  backToCategoriesText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    letterSpacing: 2,
    color: '#9a7d52',
  },
  featuredSection: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionHeading: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    letterSpacing: 2,
    color: '#a0988e',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  featuredCard: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1c1a18',
  },
  featuredCover: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  featuredInfo: {
    position: 'absolute',
    bottom: 16,
    left: 18,
    right: 18,
  },
  featuredTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 20,
    color: '#ffffff',
    marginBottom: 2,
  },
  featuredSubtext: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: '#d0c8be',
  },
  gridSection: {
    paddingHorizontal: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  card: {
    width: (width - 54) / 2,
    aspectRatio: 3 / 4,
    borderRadius: 12,
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
  title: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 2,
    lineHeight: 20,
  },
  subtext: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
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
