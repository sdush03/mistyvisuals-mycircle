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
  SafeAreaView 
} from 'react-native';

const { width } = Dimensions.get('window');

interface Story {
  id: string;
  title: string;
  subtitle: string;
  location: string;
  date: string;
  coverImage: any;
  description: string;
  images: any[];
}

interface FeaturedStoryViewProps {
  isOpen: boolean;
  onClose: () => void;
  story: Story | null;
}

export default function FeaturedStoryView({ isOpen, onClose, story }: FeaturedStoryViewProps) {
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);

  if (!story) return null;

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <SafeAreaView style={styles.header}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>✕ CLOSE</Text>
          </Pressable>
          <Text style={styles.headerTitle}>FEATURED STORY</Text>
          <View style={{ width: 60 }} /> {/* Spacer for centering */}
        </SafeAreaView>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Hero Banner */}
          <View style={styles.heroContainer}>
            <Image source={story.coverImage} style={styles.heroImage} />
            <View style={styles.heroOverlay} />
            <View style={styles.titleContainer}>
              <Text style={styles.storyLocation}>{story.location.toUpperCase()}</Text>
              <Text style={styles.storyTitle}>{story.title}</Text>
              <Text style={styles.storyDate}>{story.date}</Text>
            </View>
          </View>

          {/* Editorial Content */}
          <View style={styles.editorialContainer}>
            <Text style={styles.editorialSubtitle}>{story.subtitle.toUpperCase()}</Text>
            <View style={styles.divider} />
            <Text style={styles.descriptionText}>{story.description}</Text>
          </View>

          {/* Photo Gallery Grid */}
          <View style={styles.galleryContainer}>
            <Text style={styles.galleryHeader}>THE GALLERY</Text>
            <View style={styles.grid}>
              {story.images.map((img, index) => {
                // Alternating heights for a mini-masonry effect
                const isTall = index % 3 === 0;
                return (
                  <Pressable 
                    key={index} 
                    style={[styles.gridItem, isTall && styles.gridItemTall]}
                    onPress={() => setActiveImageIndex(index)}
                  >
                    <Image source={img} style={styles.galleryImage} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Lightbox for full screen viewing */}
        {activeImageIndex !== null && (
          <Modal
            transparent={true}
            visible={true}
            onRequestClose={() => setActiveImageIndex(null)}
          >
            <View style={styles.lightboxContainer}>
              <SafeAreaView style={styles.lightboxHeader}>
                <Pressable 
                  style={styles.lightboxClose} 
                  onPress={() => setActiveImageIndex(null)}
                >
                  <Text style={styles.lightboxCloseText}>✕ Close</Text>
                </Pressable>
              </SafeAreaView>
              <View style={styles.lightboxImageContainer}>
                <Image 
                  source={story.images[activeImageIndex]} 
                  style={styles.lightboxImage} 
                  resizeMode="contain" 
                />
              </View>
              {/* Simple Navigation */}
              <View style={styles.lightboxFooter}>
                <Pressable 
                  disabled={activeImageIndex === 0}
                  onPress={() => setActiveImageIndex(activeImageIndex - 1)}
                  style={[styles.lightboxNavButton, activeImageIndex === 0 && { opacity: 0.3 }]}
                >
                  <Text style={styles.lightboxNavText}>◀ PREV</Text>
                </Pressable>
                <Text style={styles.lightboxIndex}>
                  {activeImageIndex + 1} / {story.images.length}
                </Text>
                <Pressable 
                  disabled={activeImageIndex === story.images.length - 1}
                  onPress={() => setActiveImageIndex(activeImageIndex + 1)}
                  style={[styles.lightboxNavButton, activeImageIndex === story.images.length - 1 && { opacity: 0.3 }]}
                >
                  <Text style={styles.lightboxNavText}>NEXT ▶</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
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
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
    backgroundColor: '#ffffff',
  },
  closeButton: {
    paddingVertical: 12,
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
    paddingBottom: 40,
  },
  heroContainer: {
    width: '100%',
    height: 480,
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
    backgroundColor: 'rgba(28, 26, 24, 0.35)',
  },
  titleContainer: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
  },
  storyLocation: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 3,
    color: '#ffffff',
    marginBottom: 8,
    opacity: 0.9,
  },
  storyTitle: {
    fontFamily: 'serif',
    fontSize: 32,
    fontWeight: '300',
    color: '#ffffff',
    marginBottom: 8,
  },
  storyDate: {
    fontFamily: 'System',
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: 1,
    color: '#ffffff',
    opacity: 0.8,
  },
  editorialContainer: {
    paddingHorizontal: 24,
    paddingVertical: 40,
    alignItems: 'center',
    backgroundColor: '#fbfaf8',
  },
  editorialSubtitle: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 3,
    color: '#8c867e',
    textAlign: 'center',
    marginBottom: 16,
  },
  divider: {
    width: 40,
    height: 1,
    backgroundColor: '#ddd8d0',
    marginBottom: 24,
  },
  descriptionText: {
    fontFamily: 'serif',
    fontSize: 15,
    lineHeight: 26,
    color: '#4a4540',
    textAlign: 'center',
  },
  galleryContainer: {
    paddingHorizontal: 16,
    paddingTop: 32,
  },
  galleryHeader: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    color: '#1c1a18',
    marginBottom: 20,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  gridItem: {
    width: (width - 40) / 2,
    height: 200,
    marginBottom: 8,
    backgroundColor: '#f5f5f5',
    overflow: 'hidden',
  },
  gridItemTall: {
    height: 280,
  },
  galleryImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  lightboxContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  lightboxHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  lightboxClose: {
    padding: 12,
  },
  lightboxCloseText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
  },
  lightboxImageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxImage: {
    width: width,
    height: '80%',
  },
  lightboxFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  lightboxNavButton: {
    padding: 12,
  },
  lightboxNavText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
  lightboxIndex: {
    color: '#8c867e',
    fontSize: 12,
    fontFamily: 'System',
  },
});
