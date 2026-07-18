import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Modal,
  Dimensions,
  Alert,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { useAuthStore } from '../../store/authStore';
import api, { API_BASE_URL } from '../../services/api';

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = width / 3 - 2;

interface Photo {
  id: number;
  r2Url: string;
  width?: number;
  height?: number;
  isLiked?: boolean;
  likeCount?: number;
}

interface GalleryViewProps {
  onLogout: () => void;
  onChangeEvent: () => void;
}

export default function GalleryView({ onLogout, onChangeEvent }: GalleryViewProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [allPhotos, setAllPhotos] = useState<Photo[]>([]);
  const [viewMode, setViewMode] = useState<'matched' | 'all'>('matched');
  const [isLoading, setIsLoading] = useState(true);
  const [activePhoto, setActivePhoto] = useState<Photo | null>(null);
  const [prevOffset, setPrevOffset] = useState(0);

  const eventSlug = useAuthStore((state) => state.eventSlug);
  const profile = useAuthStore((state) => state.profile);
  const setTabBarCollapsed = useAuthStore((state) => state.setTabBarCollapsed);

  const handleScroll = (event: any) => {
    const currentOffset = event.nativeEvent.contentOffset.y;
    const direction = currentOffset > prevOffset ? 'down' : 'up';
    setPrevOffset(currentOffset);

    if (direction === 'down' && currentOffset > 60) {
      setTabBarCollapsed(true);
    } else if (direction === 'up') {
      setTabBarCollapsed(false);
    }
  };

  const fetchPhotos = async () => {
    try {
      setIsLoading(true);
      
      // Fetch matched photos
      const matchedRes = await api.get(`/api/gallery/public/events/${eventSlug}/matched-photos`);
      setPhotos(matchedRes.data.photos || []);

      // Fetch all photos (Highlights/All event photos)
      const allRes = await api.get(`/api/gallery/public/events/${eventSlug}/photos?limit=60`);
      setAllPhotos(allRes.data.photos || []);
      
    } catch (err) {
      console.error('Failed to fetch gallery photos', err);
      Alert.alert('Error', 'Failed to load photos. Please pull to refresh.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPhotos();
  }, [eventSlug]);

  const handleShare = async (url: string) => {
    try {
      await Share.share({
        message: `Check out this photo from My Circle: ${url}`,
      });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const renderPhotoItem = ({ item }: { item: Photo }) => (
    <Pressable onPress={() => setActivePhoto(item)} style={styles.gridItem}>
      <Image
        source={{ uri: item.r2Url }}
        style={styles.thumbnail}
        contentFit="cover"
        transition={200}
      />
    </Pressable>
  );

  const activeList = viewMode === 'matched' ? photos : allPhotos;

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle}>My Circle Gallery</Text>
          <Text style={styles.headerSubtitle}>{profile?.name}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.actionBtn} onPress={onChangeEvent}>
            <Text style={styles.actionBtnText}>Events</Text>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={onLogout}>
            <Text style={styles.actionBtnText}>Logout</Text>
          </Pressable>
        </View>
      </View>

      {/* Tab Switcher */}
      <View style={styles.tabContainer}>
        <Pressable
          style={[styles.tab, viewMode === 'matched' && styles.tabActive]}
          onPress={() => setViewMode('matched')}
        >
          <Text style={[styles.tabText, viewMode === 'matched' && styles.tabTextActive]}>
            Matched ({photos.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, viewMode === 'all' && styles.tabActive]}
          onPress={() => setViewMode('all')}
        >
          <Text style={[styles.tabText, viewMode === 'all' && styles.tabTextActive]}>
            All Photos
          </Text>
        </Pressable>
      </View>

      {/* Photo List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#000000" />
        </View>
      ) : activeList.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            {viewMode === 'matched'
              ? "We couldn't find any photos with your face. We'll update you if the photographer uploads new ones!"
              : 'No photos have been uploaded to this gallery yet.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={activeList}
          renderItem={renderPhotoItem}
          keyExtractor={(item) => item.id.toString()}
          numColumns={3}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchPhotos}
          refreshing={isLoading}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        />
      )}

      {/* Lightbox / Fullscreen Image Viewer Modal */}
      <Modal visible={activePhoto !== null} transparent={true} animationType="fade">
        {activePhoto && (
          <View style={styles.modalBackground}>
            {/* Top close bar */}
            <View style={styles.modalHeader}>
              <Pressable style={styles.closeBtn} onPress={() => setActivePhoto(null)}>
                <Text style={styles.closeBtnText}>Close</Text>
              </Pressable>
              
              <Pressable style={styles.shareBtn} onPress={() => handleShare(activePhoto.r2Url)}>
                <Text style={styles.shareBtnText}>Share</Text>
              </Pressable>
            </View>

            {/* Main Image */}
            <View style={styles.modalImageContainer}>
              <Image
                source={{ uri: activePhoto.r2Url }}
                style={styles.modalImage}
                contentFit="contain"
              />
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 15,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitles: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    color: '#000000',
    fontWeight: 'bold',
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(0, 0, 0, 0.5)',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#cccccc',
  },
  actionBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '600',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#f9fafb',
    padding: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
  },
  tabText: {
    color: 'rgba(0, 0, 0, 0.5)',
    fontSize: 14,
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#000000',
    fontWeight: 'bold',
  },
  listContainer: {
    padding: 1,
  },
  gridItem: {
    width: COLUMN_WIDTH,
    height: COLUMN_WIDTH,
    margin: 1,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    color: 'rgba(0, 0, 0, 0.5)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
  },
  modalHeader: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    height: 60,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 10,
  },
  closeBtn: {
    padding: 10,
  },
  closeBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  shareBtn: {
    padding: 10,
  },
  shareBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalImageContainer: {
    width: '100%',
    height: '80%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
});
