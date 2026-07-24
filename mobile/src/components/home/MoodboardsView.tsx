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
  FlatList,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

export interface Moodboard {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  coverImage: any;
  images: any[];
}

export const CURATED_MOODBOARDS: Moodboard[] = [
  {
    id: 'mb_1',
    title: 'Golden Hour',
    subtitle: 'Warm Sunset & Glowing Portraits',
    description: 'Warm golden light cascading through forest pines and open hills, highlighting genuine emotion and glowing silhouettes.',
    coverImage: require('@/assets/images/portfolio/sunset_couple.jpg'),
    images: [
      require('@/assets/images/portfolio/sunset_couple.jpg'),
      require('@/assets/images/portfolio/indian_bride.jpg'),
      require('@/assets/images/portfolio/palace_wedding.jpg'),
    ],
  },
  {
    id: 'mb_2',
    title: 'Editorial Fine Art',
    subtitle: 'High Fashion Framing & Details',
    description: 'Crisp architectural lines, intentional negative space, and couture bridal attire framed like a fashion editorial.',
    coverImage: require('@/assets/images/portfolio/indian_bride.jpg'),
    images: [
      require('@/assets/images/portfolio/indian_bride.jpg'),
      require('@/assets/images/portfolio/palace_wedding.jpg'),
      require('@/assets/images/portfolio/sunset_couple.jpg'),
    ],
  },
  {
    id: 'mb_3',
    title: 'Palace Romance',
    subtitle: 'Rajput Heritage & Royalty',
    description: 'Majestic courtyards, marble reflections, and imperial grand arches capturing timeless romance in historic palaces.',
    coverImage: require('@/assets/images/portfolio/palace_wedding.jpg'),
    images: [
      require('@/assets/images/portfolio/palace_wedding.jpg'),
      require('@/assets/images/portfolio/sunset_couple.jpg'),
      require('@/assets/images/portfolio/indian_bride.jpg'),
    ],
  },
  {
    id: 'mb_4',
    title: 'Mehendi Details',
    subtitle: 'Vibrant Colors & Henna Art',
    description: 'Intricate henna patterns, marigold garlands, and raw joyful laughter during traditional pre-wedding celebrations.',
    coverImage: require('@/assets/images/portfolio/indian_bride.jpg'),
    images: [
      require('@/assets/images/portfolio/indian_bride.jpg'),
      require('@/assets/images/portfolio/sunset_couple.jpg'),
    ],
  },
  {
    id: 'mb_5',
    title: 'Monochrome',
    subtitle: 'Classic Black & White Emotion',
    description: 'Stripping away color to reveal pure light, shadow, and unscripted raw human emotion.',
    coverImage: require('@/assets/images/portfolio/sunset_couple.jpg'),
    images: [
      require('@/assets/images/portfolio/sunset_couple.jpg'),
      require('@/assets/images/portfolio/palace_wedding.jpg'),
    ],
  },
];

interface MoodboardsViewProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBoardId?: string | null;
}

export default function MoodboardsView({ isOpen, onClose, selectedBoardId }: MoodboardsViewProps) {
  const insets = useSafeAreaInsets();
  const [activeBoard, setActiveBoard] = useState<Moodboard | null>(null);
  const [fetchedBoards, setFetchedBoards] = useState<Moodboard[]>([]);

  // Fetch dynamic inspirations from backend API
  React.useEffect(() => {
    if (isOpen) {
      fetch('https://www.mistyvisuals.com/api/app/inspirations')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            setFetchedBoards(data);
          }
        })
        .catch(() => {
          /* Keep fallback static boards on error/offline */
        });
    }
  }, [isOpen]);

  const displayBoards = fetchedBoards.length > 0 ? fetchedBoards : CURATED_MOODBOARDS;

  // Set default active board on open if specified
  React.useEffect(() => {
    if (isOpen) {
      if (selectedBoardId) {
        const found = displayBoards.find((b) => b.id === selectedBoardId);
        setActiveBoard(found || displayBoards[0]);
      }
    }
  }, [isOpen, selectedBoardId, displayBoards]);

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

            <Text style={styles.boardCategory}>INSPIRATION COLLECTION</Text>
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

            <View style={styles.boardsList}>
              {displayBoards.map((board) => (
                <Pressable
                  key={board.id}
                  style={styles.boardCard}
                  onPress={() => setActiveBoard(board)}
                >
                  <Image
                    source={typeof board.coverImage === 'string' ? { uri: board.coverImage } : board.coverImage}
                    style={styles.boardCover}
                  />
                  <View style={styles.boardOverlay} />
                  <View style={styles.boardCardContent}>
                    <Text style={styles.boardCardTitle}>{board.title}</Text>
                    {board.subtitle ? <Text style={styles.boardCardSub}>{board.subtitle}</Text> : null}
                    <Text style={styles.boardCardCta}>Explore Collection →</Text>
                  </View>
                </Pressable>
              ))}
            </View>
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
    color: '#8c867e',
  },
  headerTitle: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    color: '#1c1a18',
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 60,
  },
  backLink: {
    marginBottom: 16,
  },
  backLinkText: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    color: '#a07850',
  },
  introContainer: {
    marginBottom: 24,
  },
  introTag: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 3,
    color: '#a07850',
    marginBottom: 6,
  },
  introHeading: {
    fontFamily: 'serif',
    fontSize: 26,
    fontWeight: '300',
    color: '#1c1a18',
    marginBottom: 8,
  },
  introSub: {
    fontFamily: 'serif',
    fontSize: 14,
    color: '#60646c',
    lineHeight: 20,
  },
  boardsList: {
    gap: 20,
  },
  boardCard: {
    width: '100%',
    height: 200,
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  boardCover: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  boardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(28, 26, 24, 0.45)',
  },
  boardCardContent: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  boardCardTitle: {
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '300',
    color: '#ffffff',
    marginBottom: 4,
  },
  boardCardSub: {
    fontFamily: 'System',
    fontSize: 11,
    color: '#e0d8ce',
    letterSpacing: 1,
    marginBottom: 10,
  },
  boardCardCta: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    color: '#ffffff',
  },
  boardCategory: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 3,
    color: '#a07850',
    marginBottom: 6,
  },
  boardTitle: {
    fontFamily: 'serif',
    fontSize: 30,
    fontWeight: '300',
    color: '#1c1a18',
    marginBottom: 4,
  },
  boardSubtitle: {
    fontFamily: 'System',
    fontSize: 12,
    color: '#8c867e',
    letterSpacing: 1,
    marginBottom: 12,
  },
  boardDescription: {
    fontFamily: 'serif',
    fontSize: 14,
    lineHeight: 22,
    color: '#3a3630',
    marginBottom: 20,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: '#f0ede8',
    marginBottom: 24,
  },
  gridContainer: {
    gap: 16,
  },
  gridCard: {
    width: '100%',
    height: 240,
    backgroundColor: '#f9fafb',
  },
  gridImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
});
