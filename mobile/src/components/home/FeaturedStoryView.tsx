import React, { useState } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  Modal, 
  ScrollView, 
  Image, 
  Pressable, 
  Dimensions 
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';

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
  const insets = useSafeAreaInsets();

  if (!story) return null;

  const locationText = (story.location || '').toUpperCase();
  const titleText = story.title || '';
  const dateText = story.date || '';
  const subtitleText = (story.subtitle || '').toUpperCase();
  const descriptionText = story.description || '';
  const galleryImages = Array.isArray(story.images) ? story.images : [];

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>✕ CLOSE</Text>
          </Pressable>
          <Text style={styles.headerTitle}>FEATURED STORY</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Hero Banner */}
          <View style={styles.heroContainer}>
            <Image source={story.coverImage} style={styles.heroImage} />
            <LinearGradient
              colors={['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.65)']}
              locations={[0, 0.5, 1]}
              style={styles.heroOverlay}
            />
            <View style={styles.titleContainer}>
              {locationText ? <Text style={styles.storyLocation}>{locationText}</Text> : null}
              {titleText ? <Text style={styles.storyTitle}>{titleText}</Text> : null}
              {dateText ? <Text style={styles.storyDate}>{dateText}</Text> : null}
            </View>
          </View>

          {/* Editorial Content */}
          <View style={styles.editorialContainer}>
            {subtitleText ? <Text style={styles.editorialSubtitle}>{subtitleText}</Text> : null}
            <View style={styles.divider} />
            {descriptionText ? <Text style={styles.descriptionText}>{descriptionText}</Text> : null}
          </View>

          {/* Photo Gallery Grid */}
          <View style={styles.galleryContainer}>
            <Text style={styles.galleryHeader}>THE GALLERY</Text>
            <View style={styles.grid}>
              {galleryImages.map((img, index) => {
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
              <View style={[styles.lightboxHeader, { paddingTop: Math.max(insets.top, 12) }]}>
                <Pressable 
                  style={styles.lightboxClose} 
                  onPress={() => setActiveImageIndex(null)}
                >
                  <Text style={styles.lightboxCloseText}>✕ Close</Text>
                </Pressable>
              </View>
              <View style={styles.lightboxImageContainer}>
                {galleryImages[activeImageIndex] ? (
                  <Image 
                    source={galleryImages[activeImageIndex]} 
                    style={styles.lightboxImage} 
                    resizeMode="contain" 
                  />
                ) : null}
              </View>
              {/* Simple Navigation */}
              <View style={[styles.lightboxFooter, { paddingBottom: Math.max(insets.bottom, 24) }]}>
                <Pressable 
                  disabled={activeImageIndex === 0}
                  onPress={() => setActiveImageIndex(activeImageIndex - 1)}
                  style={[styles.lightboxNavButton, activeImageIndex === 0 && { opacity: 0.3 }]}
                >
                  <Text style={styles.lightboxNavText}>◀ PREV</Text>
                </Pressable>
                <Text style={styles.lightboxIndex}>
                  {`${activeImageIndex + 1} / ${galleryImages.length}`}
                </Text>
                <Pressable 
                  disabled={activeImageIndex === galleryImages.length - 1}
                  onPress={() => setActiveImageIndex(activeImageIndex + 1)}
                  style={[styles.lightboxNavButton, activeImageIndex === galleryImages.length - 1 && { opacity: 0.3 }]}
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
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    letterSpacing: 2,
    color: '#8c867e',
  },
  headerTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
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
  },
  titleContainer: {
    position: 'absolute',
    bottom: 40,
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
    fontSize: 30,
    color: '#ffffff',
    marginBottom: 8,
  },
  storyDate: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
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
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 10,
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
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 15,
    lineHeight: 25,
    color: '#4a4540',
    textAlign: 'center',
  },
  galleryContainer: {
    paddingHorizontal: 16,
    paddingTop: 32,
  },
  galleryHeader: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
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
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 12,
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
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 10,
    letterSpacing: 2,
  },
  lightboxIndex: {
    color: '#8c867e',
    fontSize: 12,
    fontFamily: FONT_JOST_REGULAR,
  },
});
