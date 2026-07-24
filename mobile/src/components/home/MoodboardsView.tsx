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

export default function MoodboardsView({ isOpen, onClose, selectedBoardId, selectedCategoryName, inspirations, onSelectInspiration }: MoodboardsViewProps) {
  const insets = useSafeAreaInsets();
  const [activeBoard, setActiveBoard] = useState<Moodboard | null>(null);
  const [fetchedBoards, setFetchedBoards] = useState<Moodboard[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');

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
          .then(res => res.json())
          .then(data => {
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
      <View style={styles.container}>
        {/* Top Header */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>✕ CLOSE</Text>
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

            <Text style={styles.boardCategory}>{(activeBoard.category || 'INSPIRATION COLLECTION').toUpperCase()}</Text>
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
          /* All Moodboards List View */
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.introContainer}>
              <Text style={styles.introTag}>INSPIRATION & STYLING</Text>
              <Text style={styles.introHeading}>Curated Fine Art Inspirations</Text>
              <Text style={styles.introSub}>
                Explore visual palettes, lighting directions, and editorial framing curated by Misty Visuals.
              </Text>
            </View>

            {/* Category Filter Pills */}
            {categories.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vibePillScroll}>
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
            )}

            {filteredBoards.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No published inspiration collections available in this category.</Text>
              </View>
            ) : (
              <View style={styles.boardsList}>
                {filteredBoards.map((board) => {
                  const coverSrc = board.coverImageMobile || board.coverImage;
                  return (
                    <Pressable
                      key={board.id}
                      style={styles.boardCard}
                      onPress={() => handleCardPress(board)}
                    >
                      <Image
                        source={typeof coverSrc === 'string' ? { uri: coverSrc } : coverSrc}
                        style={styles.boardCover}
                      />
                      <View style={styles.boardOverlay} />
                      <View style={styles.boardCardContent}>
                        {board.category ? (
                          <Text style={styles.boardCardCategory}>{(board.category || '').toUpperCase()}</Text>
                        ) : null}
                        <Text style={styles.boardCardTitle}>{board.title}</Text>
                        {board.subtitle ? <Text style={styles.boardCardSub}>{board.subtitle}</Text> : null}
                        <Text style={styles.boardCardCta}>Explore Collection →</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}
      </View>
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
  closeButton: {
    paddingVertical: 8,
  },
  closeText: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#1a1a1a',
  },
  headerTitle: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#8c867e',
  },
  scrollContent: {
    paddingBottom: 60,
  },
  introContainer: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
  },
  introTag: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#9a7d52',
    marginBottom: 8,
  },
  introHeading: {
    fontFamily: 'System',
    fontSize: 26,
    fontWeight: '300',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  introSub: {
    fontFamily: 'System',
    fontSize: 13,
    lineHeight: 20,
    color: '#666666',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'System',
    fontSize: 13,
    color: '#999999',
  },
  boardsList: {
    paddingHorizontal: 20,
    gap: 20,
  },
  boardCard: {
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1a1a1a',
  },
  boardCover: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    resizeMode: 'cover',
  },
  boardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  boardCardContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
  },
  boardCardTitle: {
    fontFamily: 'System',
    fontSize: 22,
    fontWeight: '400',
    color: '#ffffff',
    marginBottom: 4,
  },
  boardCardSub: {
    fontFamily: 'System',
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 12,
  },
  boardCardCta: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    color: '#e2d5c3',
  },
  backLink: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 12,
  },
  backLinkText: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    color: '#9a7d52',
  },
  boardCategory: {
    paddingHorizontal: 24,
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#8c867e',
    marginBottom: 6,
  },
  boardTitle: {
    paddingHorizontal: 24,
    fontFamily: 'System',
    fontSize: 28,
    fontWeight: '300',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  boardSubtitle: {
    paddingHorizontal: 24,
    fontFamily: 'System',
    fontSize: 14,
    color: '#666666',
    marginBottom: 12,
  },
  boardDescription: {
    paddingHorizontal: 24,
    fontFamily: 'System',
    fontSize: 13,
    lineHeight: 20,
    color: '#444444',
  },
  divider: {
    height: 1,
    backgroundColor: '#f0ede8',
    marginHorizontal: 24,
    marginVertical: 24,
  },
  gridContainer: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridCard: {
    width: (width - 52) / 2,
    aspectRatio: 3 / 4,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  gridImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  boardCardCategory: {
    fontFamily: 'System',
    fontSize: 8.5,
    fontWeight: '600',
    letterSpacing: 1.8,
    color: '#e2d5c3',
    marginBottom: 4,
  },
  vibePillScroll: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 8,
  },
  vibePill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#f5f3ef',
    borderWidth: 1,
    borderColor: '#e8e4de',
  },
  vibePillActive: {
    backgroundColor: '#1c1a18',
    borderColor: '#1c1a18',
  },
  vibeText: {
    fontFamily: 'System',
    fontSize: 11,
    color: '#666666',
  },
  vibeTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
