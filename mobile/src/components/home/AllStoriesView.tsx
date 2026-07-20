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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>✕ CLOSE</Text>
          </Pressable>
          <Text style={styles.headerTitle}>WEDDING COLLECTIONS</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Vibe Tabs Bar */}
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

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionHeading}>
            {selectedVibe === 'All' ? 'All Stories' : `${selectedVibe} Stories`} ({filteredStories.length})
          </Text>

          {filteredStories.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No stories found for "{selectedVibe}".</Text>
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
                    <Image source={imageSource} style={styles.storyCover} />
                    <View style={styles.storyOverlay} />
                    <View style={styles.storyInfo}>
                      <Text style={styles.storyCategory}>{(story.category || 'WEDDING').toUpperCase()}</Text>
                      <Text style={styles.storyTitle}>{story.title}</Text>
                      {story.location ? <Text style={styles.storyLocation}>📍 {story.location}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
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
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e5e0d8',
    backgroundColor: '#ffffff',
  },
  vibePillActive: {
    backgroundColor: '#1c1a18',
    borderColor: '#1c1a18',
  },
  vibeText: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '600',
    color: '#60646c',
  },
  vibeTextActive: {
    color: '#ffffff',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 60,
  },
  sectionHeading: {
    fontFamily: 'System',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#8c867e',
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  storiesGrid: {
    gap: 20,
  },
  storyCard: {
    width: '100%',
    height: 220,
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#f9fafb',
  },
  storyCover: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  storyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(28, 26, 24, 0.35)',
  },
  storyInfo: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
  storyCategory: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#a07850',
    marginBottom: 4,
  },
  storyTitle: {
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '300',
    color: '#ffffff',
    marginBottom: 4,
  },
  storyLocation: {
    fontFamily: 'System',
    fontSize: 11,
    color: '#d0c8be',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'serif',
    fontSize: 14,
    color: '#8c867e',
  },
});
