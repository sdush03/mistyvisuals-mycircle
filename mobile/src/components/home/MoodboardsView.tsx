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

export interface Moodboard {
  id: string | number;
  slug?: string;
  title: string;
  subtitle?: string;
  description?: string;
  category?: string;
  coverImage?: any;
  coverImageMobile?: any;
  images?: any[];
}

interface MoodboardsViewProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBoardId?: string | number | null;
  selectedCategoryName?: string;
  inspirations?: Moodboard[];
  onSelectInspiration?: (board: Moodboard) => void;
}

export default function MoodboardsView({
  isOpen,
  onClose,
  selectedBoardId,
  selectedCategoryName,
  inspirations,
  onSelectInspiration,
}: MoodboardsViewProps) {
  const insets = useSafeAreaInsets();
  const [activeBoard, setActiveBoard] = useState<Moodboard | null>(null);
  const [fetchedBoards, setFetchedBoards] = useState<Moodboard[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');

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
            if (activeBoard !== null) {
              runOnJS(setActiveBoard)(null);
            } else {
              runOnJS(onClose)();
            }
          });
        } else {
          translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
        }
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  React.useEffect(() => {
    if (isOpen) {
      if (selectedCategoryName) {
        setSelectedCategory(selectedCategoryName);
      } else {
        setSelectedCategory('All');
      }
    }
  }, [isOpen, selectedCategoryName]);

  // Fetch dynamic inspirations from backend API if not passed via props
  React.useEffect(() => {
    if (isOpen) {
      if (inspirations && inspirations.length > 0) {
        setFetchedBoards(inspirations);
      } else {
        fetch('https://www.mistyvisuals.com/api/app/inspirations')
          .then((res) => res.json())
          .then((data) => {
            if (Array.isArray(data)) {
              setFetchedBoards(data);
            }
          })
          .catch(() => {});
      }
    }
  }, [isOpen, inspirations]);

  const displayBoards = fetchedBoards.length > 0 ? fetchedBoards : (inspirations || []);

  const categories = React.useMemo(() => {
    const catsSet = new Set<string>();
    displayBoards.forEach((b: any) => {
      const cats = (b.category || '').split(',').map((c: string) => c.trim()).filter(Boolean);
      cats.forEach((c: string) => catsSet.add(c));
    });
    if (catsSet.size === 0) return [];
    return ['All', ...Array.from(catsSet).sort()];
  }, [displayBoards]);

  const filteredBoards = React.useMemo(() => {
    if (selectedCategory === 'All') return displayBoards;
    const catLower = selectedCategory.toLowerCase();
    return displayBoards.filter((b: any) => {
      const bCats = (b.category || '').split(',').map((c: string) => c.trim().toLowerCase());
      return bCats.includes(catLower);
    });
  }, [displayBoards, selectedCategory]);

  // Set default active board on open if specified
  React.useEffect(() => {
    if (isOpen) {
      if (selectedBoardId !== null && selectedBoardId !== undefined) {
        const found = displayBoards.find((b) => String(b.id) === String(selectedBoardId));
        if (found) {
          if (onSelectInspiration) {
            onClose();
            onSelectInspiration(found);
          } else {
            setActiveBoard(found);
          }
        }
      }
    }
  }, [isOpen, selectedBoardId, displayBoards, onSelectInspiration, onClose]);

  // Android hardware back button handler
  React.useEffect(() => {
    if (!isOpen) return;
    const onBackPress = () => {
      if (activeBoard !== null) {
        setActiveBoard(null);
        return true;
      }
      onClose();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [isOpen, activeBoard, onClose]);

  const handleCardPress = (board: Moodboard) => {
    if (onSelectInspiration) {
      onClose();
      onSelectInspiration(board);
    } else {
      setActiveBoard(board);
    }
  };

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
              <Pressable
                style={styles.backButton}
                onPress={() => {
                  if (activeBoard) {
                    setActiveBoard(null);
                  } else {
                    onClose();
                  }
                }}
              >
                <Text style={styles.backText}>← BACK</Text>
              </Pressable>
              <Text style={styles.headerTitle}>FINE ART INSPIRATIONS</Text>
              <View style={{ width: 60 }} />
            </View>

            {activeBoard ? (
              /* Active Moodboard Detail View */
              <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <Pressable style={styles.backLink} onPress={() => setActiveBoard(null)}>
                  <Text style={styles.backLinkText}>← ALL INSPIRATIONS</Text>
                </Pressable>

                <Text style={styles.boardCategory}>
                  {(activeBoard.category || 'INSPIRATION COLLECTION').toUpperCase()}
                </Text>
                <Text style={styles.boardTitle}>{activeBoard.title}</Text>
                {activeBoard.subtitle ? <Text style={styles.boardSubtitle}>{activeBoard.subtitle}</Text> : null}
                {activeBoard.description ? <Text style={styles.boardDescription}>{activeBoard.description}</Text> : null}

                <View style={styles.divider} />

                {/* Inspiration Grid */}
                <View style={styles.gridContainer}>
                  {(activeBoard.images || []).map((img, idx) => (
                    <View key={idx} style={styles.gridCard}>
                      <Image source={typeof img === 'string' ? { uri: img } : img} style={styles.gridImage} />
                    </View>
                  ))}
                </View>
              </ScrollView>
            ) : (
              /* Moodboards List View */
              <View style={{ flex: 1 }}>
                {/* Category Filter Pills */}
                {categories.length > 0 && (
                  <View style={styles.vibeBarContainer}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vibeScroll}>
                      {categories.map((cat) => (
                        <Pressable
                          key={cat}
                          style={[styles.vibePill, selectedCategory === cat && styles.vibePillActive]}
                          onPress={() => setSelectedCategory(cat)}
                        >
                          <Text style={[styles.vibeText, selectedCategory === cat && styles.vibeTextActive]}>{cat}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}

                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeading}>
                      {selectedCategory === 'All' ? 'ALL INSPIRATIONS' : `${selectedCategory.toUpperCase()} INSPIRATIONS`}
                    </Text>
                    <Text style={styles.countText}>{filteredBoards.length} COLLECTIONS</Text>
                  </View>

                  {filteredBoards.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <Text style={styles.emptyText}>No inspiration collections found under "{selectedCategory}".</Text>
                    </View>
                  ) : (
                    <View style={styles.boardsList}>
                      {filteredBoards.map((board) => {
                        const coverSrc = board.coverImageMobile || board.coverImage || (board.images && board.images[0]);
                        const formattedTitle = (board.title || '')
                          .split(' ')
                          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                          .join(' ');
                        const photoCount = Array.isArray(board.images) ? board.images.length : 0;
                        const subtext = photoCount > 0
                          ? `${photoCount} ${photoCount === 1 ? 'Photo' : 'Photos'} →`
                          : 'Explore Collection →';

                        return (
                          <Pressable
                            key={board.id}
                            style={styles.boardCard}
                            onPress={() => handleCardPress(board)}
                          >
                            {coverSrc ? (
                              <Image
                                source={typeof coverSrc === 'string' ? { uri: coverSrc } : coverSrc}
                                style={styles.boardCover}
                              />
                            ) : (
                              <View style={[styles.boardCover, { backgroundColor: '#18181b' }]} />
                            )}
                            <LinearGradient
                              colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.88)']}
                              locations={[0, 0.45, 1]}
                              style={styles.boardOverlay}
                            />
                            <View style={styles.boardCardContent}>
                              {board.category ? (
                                <Text style={styles.boardCardCategory}>
                                  {board.category.toUpperCase()}
                                </Text>
                              ) : null}
                              <Text style={styles.boardCardTitle} numberOfLines={1}>{formattedTitle}</Text>
                              <Text style={styles.boardCardSub} numberOfLines={1}>{subtext}</Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </ScrollView>
              </View>
            )}
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
  backLink: {
    paddingBottom: 12,
  },
  backLinkText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#9a7d52',
  },
  boardCategory: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 9,
    letterSpacing: 2,
    color: '#a07850',
    marginBottom: 6,
  },
  boardTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 24,
    color: '#ffffff',
    marginBottom: 6,
  },
  boardSubtitle: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    color: '#d0c8be',
    marginBottom: 10,
  },
  boardDescription: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12.5,
    lineHeight: 19,
    color: '#a0988e',
  },
  divider: {
    height: 1,
    backgroundColor: '#24211e',
    marginVertical: 20,
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
  boardsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  boardCard: {
    width: (width - 54) / 2,
    height: 230,
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1c1a18',
  },
  boardCover: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  boardOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  boardCardContent: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
  },
  boardCardCategory: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 8.5,
    letterSpacing: 1.8,
    color: '#a07850',
    marginBottom: 4,
  },
  boardCardTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 2,
  },
  boardCardSub: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10.5,
    color: '#d0c8be',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridCard: {
    width: (width - 52) / 2,
    aspectRatio: 3 / 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: '#1c1a18',
  },
  gridImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
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
