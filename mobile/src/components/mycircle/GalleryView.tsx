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
import { useScrollTabBarCollapse } from '../../hooks/useScrollTabBarCollapse';
import api, { guestApi, API_BASE_URL } from '../../services/api';

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
  const [totalAllPhotosCount, setTotalAllPhotosCount] = useState<number | null>(null);
  const [eventDetails, setEventDetailsData] = useState<any>(null);
  const [showCoverScreen, setShowCoverScreen] = useState(true);
  const [viewMode, setViewMode] = useState<'matched' | 'all'>('matched');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [allPhotosOffset, setAllPhotosOffset] = useState(0);
  const [hasMorePhotos, setHasMorePhotos] = useState(true);
  const [activePhoto, setActivePhoto] = useState<Photo | null>(null);
  const [prevOffset, setPrevOffset] = useState(0);
  const eventHeadersRef = React.useRef<Record<string, string>>({});

  const PAGE_SIZE = 100;

  const eventSlug = useAuthStore((state) => state.eventSlug);
  const passcode = useAuthStore((state) => state.passcode);
  const profile = useAuthStore((state) => state.profile);
  const eventCoverUrl = useAuthStore((state) => state.eventCoverUrl);
  const eventTitle = useAuthStore((state) => state.eventTitle);
  const setTabBarCollapsed = useAuthStore((state) => state.setTabBarCollapsed);
  const handleScroll = useScrollTabBarCollapse();

  const fetchPhotos = async () => {
    try {
      setIsLoading(true);
      setAllPhotos([]);
      setAllPhotosOffset(0);
      setHasMorePhotos(true);
      setTotalAllPhotosCount(null);

      if (!eventSlug) return;

      // Fetch event metadata for cover screen
      try {
        const eventRes = await api.get(`/api/gallery/public/events/${eventSlug}`);
        if (eventRes.data) {
          setEventDetailsData(eventRes.data);
        }
      } catch (e: any) {
        if (e?.response?.status === 404) {
          Alert.alert('Celebration Not Found', 'This celebration is no longer available or the link is invalid.');
          onChangeEvent();
          return;
        }
        console.warn('Failed to fetch event details:', e);
      }

      const familyToken = useAuthStore.getState().token;
      const currentPasscode = useAuthStore.getState().passcode;

      // 1. SSO Token Exchange: Obtain event guest token for this celebration
      try {
        const ssoRes = await api.post(
          `/api/gallery/public/events/${eventSlug}/auth-from-family`,
          { code: currentPasscode || undefined },
          { headers: familyToken ? { Authorization: `Bearer ${familyToken}` } : {} }
        );
        if (ssoRes.data?.token) {
          eventHeadersRef.current = { Authorization: `Bearer ${ssoRes.data.token}` };
        } else if (familyToken) {
          eventHeadersRef.current = { Authorization: `Bearer ${familyToken}` };
        }
      } catch (e: any) {
        if (e?.response?.status === 404) {
          Alert.alert('Celebration Not Found', 'This celebration is no longer available or the link is invalid.');
          onChangeEvent();
          return;
        }
        const errDetail = e?.response?.data?.error || (typeof e?.response?.data === 'string' ? e?.response?.data : JSON.stringify(e?.response?.data)) || e?.message;
        console.warn('SSO token exchange failed:', errDetail);
        if (familyToken) {
          eventHeadersRef.current = { Authorization: `Bearer ${familyToken}` };
        }
      }

      const eventHeaders = eventHeadersRef.current;

      const mapPhotoItem = (p: any): Photo => ({
        id: p.id,
        r2Url: p.r2Url || p.thumbnailUrl || p.r2_url || p.file_url_mobile || p.file_url || p.url || '',
        width: p.width,
        height: p.height,
        isLiked: !!(p.likes && p.likes.length > 0),
        likeCount: p._count?.likes || 0,
      });

      // 2. Fetch matched photos independently using guest token
      try {
        const matchedRes = await guestApi.get(
          `/api/gallery/public/events/${eventSlug}/matched-photos`,
          { headers: eventHeaders }
        );
        const matchedList = matchedRes.data.photos || matchedRes.data.matchedPhotos || (Array.isArray(matchedRes.data) ? matchedRes.data : []);
        setPhotos(Array.isArray(matchedList) ? matchedList.map(mapPhotoItem) : []);
      } catch (e: any) {
        console.warn('Matched photos fetch error:', e?.response?.status, e?.response?.data?.error);
        setPhotos([]);
      }

      // 3. Fetch first page of all photos using guest token
      try {
        const allRes = await guestApi.get(
          `/api/gallery/public/events/${eventSlug}/photos?limit=${PAGE_SIZE}&offset=0`,
          { headers: eventHeaders }
        );
        const allList = allRes.data.photos || (Array.isArray(allRes.data) ? allRes.data : []);
        const mapped = Array.isArray(allList) ? allList.map(mapPhotoItem) : [];
        const total = typeof allRes.data.total === 'number' ? allRes.data.total : mapped.length;
        setTotalAllPhotosCount(total);
        setAllPhotos(mapped);
        setAllPhotosOffset(mapped.length);
        setHasMorePhotos(mapped.length < total);
      } catch (e: any) {
        console.warn('All photos fetch error:', e?.response?.status, e?.response?.data?.error);
        setAllPhotos([]);
      }
    } catch (err) {
      console.warn('Failed to fetch gallery photos', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMorePhotos = async () => {
    if (!hasMorePhotos || isLoadingMore || isLoading || !eventSlug) return;
    try {
      setIsLoadingMore(true);
      const eventHeaders = eventHeadersRef.current;
      const allRes = await guestApi.get(
        `/api/gallery/public/events/${eventSlug}/photos?limit=${PAGE_SIZE}&offset=${allPhotosOffset}`,
        { headers: eventHeaders }
      );
      const allList = allRes.data.photos || (Array.isArray(allRes.data) ? allRes.data : []);
      const mapPhotoItem = (p: any): Photo => ({
        id: p.id,
        r2Url: p.r2Url || p.thumbnailUrl || p.r2_url || p.file_url_mobile || p.file_url || p.url || '',
        width: p.width,
        height: p.height,
        isLiked: !!(p.likes && p.likes.length > 0),
        likeCount: p._count?.likes || 0,
      });
      const mapped = Array.isArray(allList) ? allList.map(mapPhotoItem) : [];
      if (mapped.length > 0) {
        setAllPhotos((prev) => {
          const next = [...prev, ...mapped];
          if (totalAllPhotosCount !== null && next.length >= totalAllPhotosCount) {
            setHasMorePhotos(false);
          }
          return next;
        });
        setAllPhotosOffset((prev) => prev + mapped.length);
      } else {
        setHasMorePhotos(false);
      }
    } catch (e: any) {
      console.warn('Load more error:', e?.response?.status);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    setShowCoverScreen(true);
    fetchPhotos();
  }, [eventSlug]);

  // Auto-switch to 'all' photos tab if matched photos count is 0
  useEffect(() => {
    if (!isLoading && photos.length === 0 && allPhotos.length > 0) {
      setViewMode('all');
    }
  }, [isLoading, photos.length, allPhotos.length]);

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

  // ── Cover Screen View ──────────────────────────────────────────────────────
  if (showCoverScreen) {
    const coverUrl =
      eventCoverUrl ||
      eventDetails?.coverPhotoMobileUrl ||
      eventDetails?.coverPhotoUrl ||
      null;
    const cleanTitle = (eventTitle || eventDetails?.title || eventSlug || 'WEDDING CELEBRATION')
      .replace(/'s\s+Wedding/gi, '')
      .replace('&', '·')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    const formattedDate = eventDetails?.date
      ? new Date(eventDetails.date).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
      : '';

    return (
      <View style={styles.coverContainer}>
        {/* Background Cover Image */}
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={300}
          />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#111111', justifyContent: 'center', alignItems: 'center' }]}>
            <ActivityIndicator size="small" color="#ffffff" />
          </View>
        )}
        {/* Dark Vignette Overlay */}
        <View style={styles.coverOverlay} />

        {/* Hero Top Bar */}
        <View style={styles.coverHeader}>
          <Image
            source={require('@/assets/images/logo-black.png')}
            style={[styles.coverLogo, { tintColor: '#ffffff' }]}
            contentFit="contain"
          />
        </View>

        {/* Hero Center Text & Button */}
        <View style={styles.coverCenterContent}>
          <Text style={styles.coverTitle}>{cleanTitle}</Text>
          {formattedDate ? <Text style={styles.coverDate}>{formattedDate}</Text> : null}

          <Pressable
            style={({ pressed }) => [
              styles.viewGalleryBtn,
              pressed && { backgroundColor: 'rgba(255, 255, 255, 0.25)' },
            ]}
            onPress={() => {
              setShowCoverScreen(false);
              setTabBarCollapsed(false);
            }}
          >
            <Text style={styles.viewGalleryBtnText}>VIEW GALLERY →</Text>
          </Pressable>
        </View>

        {/* Hero Footer */}
        <View style={styles.coverFooter}>
          <Text style={styles.coverPhotoCountText}>
            {totalAllPhotosCount !== null ? `${totalAllPhotosCount.toLocaleString()} PHOTOGRAPHS` : 'CELEBRATION GALLERY'}
          </Text>
        </View>
      </View>
    );
  }

  const activeList = viewMode === 'matched' ? photos : allPhotos;

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.header}>
        <Pressable style={styles.coverBackBtn} onPress={() => setShowCoverScreen(true)}>
          <Text style={styles.coverBackBtnText}>← Cover</Text>
        </Pressable>
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
            All Photos ({totalAllPhotosCount !== null ? totalAllPhotosCount.toLocaleString() : allPhotos.length})
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
          onEndReached={viewMode === 'all' ? loadMorePhotos : undefined}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            viewMode === 'all' && isLoadingMore ? (
              <View style={{ padding: 16, alignItems: 'center' }}>
                <ActivityIndicator size="small" color="#8c867e" />
              </View>
            ) : null
          }
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
  coverContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  coverHeader: {
    paddingTop: 54,
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  coverLogo: {
    width: 140,
    height: 32,
  },
  coverCenterContent: {
    alignItems: 'center',
    paddingHorizontal: 32,
    zIndex: 10,
  },
  coverTitle: {
    fontSize: 26,
    fontWeight: '400',
    letterSpacing: 4,
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 36,
  },
  coverDate: {
    fontSize: 12,
    letterSpacing: 3,
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '500',
    marginBottom: 36,
    textAlign: 'center',
  },
  viewGalleryBtn: {
    borderWidth: 1,
    borderColor: '#ffffff',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  viewGalleryBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 3,
  },
  coverFooter: {
    paddingBottom: 40,
    alignItems: 'center',
    zIndex: 10,
  },
  coverPhotoCountText: {
    fontSize: 11,
    letterSpacing: 2.5,
    color: 'rgba(255, 255, 255, 0.75)',
    fontWeight: '400',
  },
  coverBackBtn: {
    marginRight: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 4,
  },
  coverBackBtnText: {
    fontSize: 12,
    color: '#333333',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 15,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitles: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    color: '#000000',
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(0, 0, 0, 0.5)',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 4,
  },
  actionBtnText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '600',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
  },
  tabText: {
    color: 'rgba(0, 0, 0, 0.45)',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  tabTextActive: {
    color: '#000000',
    fontWeight: '700',
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
