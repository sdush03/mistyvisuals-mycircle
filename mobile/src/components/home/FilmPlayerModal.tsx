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
  Linking,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const { width } = Dimensions.get('window');

export interface Film {
  id: string;
  title: string;
  subtitle?: string;
  location?: string;
  video_url?: string;
  youtube_url?: string;
  youtube_video_id?: string;
  thumbnail_url?: any;
  category?: string;
}

interface FilmPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  film: Film | null;
}

// Helper to parse 11-character YouTube video ID
const extractYouTubeId = (film: Film | null): string | null => {
  if (!film) return null;
  if (film.youtube_video_id) return film.youtube_video_id;
  const targetUrl = film.youtube_url || film.video_url || '';
  const match = targetUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : null;
};

export default function FilmPlayerModal({ isOpen, onClose, film }: FilmPlayerModalProps) {
  const insets = useSafeAreaInsets();
  const [isPlaying, setIsPlaying] = useState(false);

  // Android hardware back button handler
  React.useEffect(() => {
    if (!isOpen) return;
    const onBackPress = () => {
      setIsPlaying(false);
      onClose();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [isOpen, onClose]);

  if (!film) return null;

  const videoId = extractYouTubeId(film);
  const rawUrl = film.youtube_url || film.video_url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');

  const thumbnailSource =
    typeof film.thumbnail_url === 'string'
      ? { uri: film.thumbnail_url }
      : film.thumbnail_url
      ? film.thumbnail_url
      : videoId
      ? { uri: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` }
      : null;

  const handleOpenYouTubeApp = () => {
    if (rawUrl) {
      Linking.openURL(rawUrl).catch((err) => {
        console.warn('Could not open YouTube URL:', err);
      });
    }
  };

  const handleCloseModal = () => {
    setIsPlaying(false);
    onClose();
  };

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleCloseModal}
    >
      <View style={styles.container}>
        {/* Top Bar */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
          <Pressable style={styles.closeButton} onPress={handleCloseModal}>
            <Text style={styles.closeText}>✕ CLOSE</Text>
          </Pressable>
          <Text style={styles.headerTitle}>CINEMA</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Film Player / Poster Container */}
          <View style={styles.posterContainer}>
            {isPlaying && videoId ? (
              <WebView
                source={{
                  uri: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`,
                }}
                style={styles.webView}
                allowsFullscreenVideo={true}
                javaScriptEnabled={true}
                domStorageEnabled={true}
              />
            ) : (
              <>
                <Image source={thumbnailSource} style={styles.posterImage} />
                <View style={styles.posterOverlay} />

                {/* Play Button Icon */}
                <Pressable
                  style={styles.playButton}
                  onPress={() => {
                    if (videoId) {
                      setIsPlaying(true);
                    } else {
                      handleOpenYouTubeApp();
                    }
                  }}
                >
                  <View style={styles.playIconInner}>
                    <Text style={styles.playTriangle}>▶</Text>
                  </View>
                </Pressable>
              </>
            )}
          </View>

          {/* Metadata */}
          <View style={styles.metaContainer}>
            <Text style={styles.categoryTag}>
              {(film.category || film.subtitle || 'FINE ART FILM').toUpperCase()}
            </Text>
            <Text style={styles.filmTitle}>{film.title}</Text>
            {film.location ? <Text style={styles.filmLocation}>📍 {film.location}</Text> : null}

            <View style={styles.divider} />

            <Text style={styles.filmDescription}>
              Fine art wedding photography and cinematic films by Misty Visuals. Captured with
              unscripted emotion, natural light, and timeless framing.
            </Text>

            {/* Action Buttons */}
            {rawUrl ? (
              <Pressable style={styles.ctaButton} onPress={handleOpenYouTubeApp}>
                <Text style={styles.ctaButtonText}>OPEN IN YOUTUBE APP ↗</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#141210',
  },
  webView: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: '#141210',
  },
  closeButton: {
    paddingVertical: 8,
  },
  closeText: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#a07850',
  },
  headerTitle: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    color: '#ffffff',
    textAlign: 'center',
  },
  scrollContent: {
    paddingBottom: 60,
  },
  posterContainer: {
    width: '100%',
    height: 320,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  posterImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  posterOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  playButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(160, 120, 80, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  playIconInner: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 4,
  },
  playTriangle: {
    color: '#ffffff',
    fontSize: 24,
  },
  metaContainer: {
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  categoryTag: {
    fontFamily: 'System',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 3,
    color: '#a07850',
    marginBottom: 8,
  },
  filmTitle: {
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '300',
    color: '#ffffff',
    lineHeight: 36,
    marginBottom: 8,
  },
  filmLocation: {
    fontFamily: 'System',
    fontSize: 12,
    color: '#a0988e',
    letterSpacing: 1,
    marginBottom: 16,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 20,
  },
  filmDescription: {
    fontFamily: 'serif',
    fontSize: 15,
    lineHeight: 24,
    color: '#d0c8be',
    marginBottom: 28,
  },
  ctaButton: {
    backgroundColor: '#a07850',
    paddingVertical: 16,
    borderRadius: 2,
    alignItems: 'center',
  },
  ctaButtonText: {
    fontFamily: 'System',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#ffffff',
  },
});
