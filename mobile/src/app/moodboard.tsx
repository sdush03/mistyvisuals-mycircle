import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  Dimensions,
  ActivityIndicator,
  Modal,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useScrollTabBarCollapse } from '../hooks/useScrollTabBarCollapse';
import { savesService, SavedPhotoItem } from '../services/savesService';
import { useAuthStore } from '../store/authStore';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
} from '../constants/fonts';

type MoodboardFilterType = 'all' | 'mine' | 'partner';

export default function MoodboardScreen() {
  const handleScroll = useScrollTabBarCollapse();
  const { profile } = useAuthStore();

  const [saves, setSaves] = useState<SavedPhotoItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [selectedFilter, setSelectedFilter] = useState<MoodboardFilterType>('all');
  const [selectedPhoto, setSelectedPhoto] = useState<SavedPhotoItem | null>(null);

  const fetchSaves = useCallback(async () => {
    try {
      const data = await savesService.getSavedPhotos();
      setSaves(data || []);
    } catch (_err) {
      setSaves([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSaves();
  }, [fetchSaves]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchSaves();
  };

  const handleUnsave = async (item: SavedPhotoItem) => {
    const success = await savesService.unsavePhoto(item.photoUrl, item.id);
    if (success) {
      setSaves((prev) => prev.filter((s) => s.id !== item.id));
      if (selectedPhoto?.id === item.id) {
        setSelectedPhoto(null);
      }
    }
  };

  // Check if item belongs to current user
  const isMine = (item: SavedPhotoItem) => {
    if (!profile) return false;
    if (profile.id && String(item.userId) === String(profile.id)) return true;
    if (profile.selfieGuestId && String(item.userId) === String(profile.selfieGuestId)) return true;
    if (
      profile.email &&
      item.savedBy?.email &&
      String(item.savedBy.email).toLowerCase().trim() === String(profile.email).toLowerCase().trim()
    ) {
      return true;
    }
    if (profile.displayRole && item.savedBy?.displayRole) {
      return profile.displayRole === item.savedBy.displayRole;
    }
    return false;
  };

  const isCoupleRole = profile?.displayRole === 'BRIDE' || profile?.displayRole === 'GROOM';

  const filteredSaves = saves.filter((item) => {
    if (selectedFilter === 'mine') return isMine(item);
    if (selectedFilter === 'partner') return !isMine(item);
    return true;
  });

  // Shortest Column Height Balancing algorithm — EXACTLY matching FeaturedStoryView
  const { column0, column1 } = React.useMemo(() => {
    const cols: [any[], any[]] = [[], []];
    const colHeights = [0, 0];

    filteredSaves.forEach((photo: any, index: number) => {
      const realAspect =
        photo.width && photo.height && Number(photo.height) > 0
          ? Number(photo.width) / Number(photo.height)
          : photo.aspectRatio || null;

      const isLandscape = realAspect ? realAspect > 1.05 : photo.isHorizontal;

      let cardAspect = 0.75;
      if (isLandscape) {
        cardAspect = realAspect && realAspect > 1.0 ? realAspect : 1.5;
      } else {
        const cycle = index % 3;
        cardAspect = cycle === 0 ? 2 / 3 : cycle === 1 ? 3 / 4 : 4 / 5;
      }

      const photoWithAspect = { ...photo, cardAspect };
      const heightContribution = 1 / cardAspect;
      const shortestIdx = colHeights[0] <= colHeights[1] ? 0 : 1;
      cols[shortestIdx].push(photoWithAspect);
      colHeights[shortestIdx] += heightContribution;
    });

    return { column0: cols[0], column1: cols[1] };
  }, [filteredSaves]);

  const renderMasonryCard = (item: any) => {
    const photoMine = isMine(item);
    return (
      <Pressable
        key={item.id}
        style={[styles.masonryCard, { aspectRatio: item.cardAspect }]}
        onPress={() => setSelectedPhoto(item)}
      >
        <Image source={{ uri: item.photoUrl }} style={styles.masonryImage} resizeMode="cover" />

        {/* Top Heart Badge */}
        <View style={styles.cardBadgeOverlay}>
          <Ionicons name="heart" size={13} color="#ef4444" />
          {item.savedBy?.displayRole && (
            <Text style={styles.badgeRoleText}>
              {photoMine ? 'YOU' : item.savedBy.displayRole}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#111111" />}
      >
        {/* ── Page Header ── */}
        <View style={styles.headerSection}>
          <Text style={styles.headerSubtitle}>YOUR PERSONAL VISUAL COLLECTION</Text>
          <Text style={styles.headerTitle}>MY MOODBOARD</Text>
          <Text style={styles.headerDesc}>
            All the photos and fine art details you heart and save across stories and inspirations in one curated collection.
          </Text>
        </View>

        {/* ── Couple Filter Pills (All / Mine / Partner) ── */}
        {isCoupleRole && (
          <View style={styles.filterPillsContainer}>
            <Pressable
              style={[styles.filterPill, selectedFilter === 'all' && styles.filterPillActive]}
              onPress={() => setSelectedFilter('all')}
            >
              <Text style={[styles.filterPillText, selectedFilter === 'all' && styles.filterPillTextActive]}>
                ALL SAVES ({saves.length})
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, selectedFilter === 'mine' && styles.filterPillActive]}
              onPress={() => setSelectedFilter('mine')}
            >
              <Text style={[styles.filterPillText, selectedFilter === 'mine' && styles.filterPillTextActive]}>
                MY SAVES
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, selectedFilter === 'partner' && styles.filterPillActive]}
              onPress={() => setSelectedFilter('partner')}
            >
              <Text style={[styles.filterPillText, selectedFilter === 'partner' && styles.filterPillTextActive]}>
                PARTNER'S SAVES
              </Text>
            </Pressable>
          </View>
        )}

        {/* ── Section Title & Count ── */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>SAVED INSPIRATIONS</Text>
          <Text style={styles.sectionCount}>{filteredSaves.length} PHOTOS</Text>
        </View>

        {/* ── Content View ── */}
        {loading ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="small" color="#111111" />
          </View>
        ) : filteredSaves.length === 0 ? (
          /* ── Empty Moodboard State ── */
          <View style={styles.emptyStateContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="heart-outline" size={32} color="#888888" />
            </View>
            <Text style={styles.emptyTitle}>YOUR MOODBOARD IS EMPTY</Text>
            <Text style={styles.emptySub}>
              Heart or save photos while exploring stories, aesthetics, and inspirations to build your personal visual moodboard.
            </Text>
            <Pressable style={styles.exploreBtn} onPress={() => router.replace('/')}>
              <Text style={styles.exploreBtnText}>EXPLORE STORIES & INSPIRATIONS</Text>
            </Pressable>
          </View>
        ) : (
          /* ── Featured Story Style Balanced 2-Column Masonry Grid ── */
          <View style={styles.masonryGridContainer}>
            <View style={styles.masonryColumn}>
              {column0.map((item) => renderMasonryCard(item))}
            </View>
            <View style={styles.masonryColumn}>
              {column1.map((item) => renderMasonryCard(item))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Photo Detail Lightbox Modal ── */}
      {selectedPhoto && (
        <Modal
          visible={!!selectedPhoto}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedPhoto(null)}
        >
          <View style={styles.lightboxOverlay}>
            <SafeAreaView style={styles.lightboxSafeArea}>
              {/* Top Close Header */}
              <View style={styles.lightboxHeader}>
                <Text style={styles.lightboxTitle}>MOODBOARD DETAIL</Text>
                <Pressable style={styles.lightboxCloseBtn} onPress={() => setSelectedPhoto(null)}>
                  <Ionicons name="close" size={24} color="#ffffff" />
                </Pressable>
              </View>

              {/* High-Res Image Display */}
              <View style={styles.lightboxImageContainer}>
                <Image
                  source={{ uri: selectedPhoto.photoUrl }}
                  style={styles.lightboxImage}
                  resizeMode="contain"
                />
              </View>

              {/* Bottom Action Footer */}
              <View style={styles.lightboxFooter}>
                <View style={styles.lightboxMeta}>
                  <Text style={styles.lightboxSavedByText}>
                    Saved by {isMine(selectedPhoto) ? 'You' : (selectedPhoto.savedBy?.displayRole || selectedPhoto.savedBy?.name || 'Partner')}
                  </Text>
                  <Text style={styles.lightboxDateText}>
                    {new Date(selectedPhoto.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </Text>
                </View>

                <Pressable style={styles.unsaveBtn} onPress={() => handleUnsave(selectedPhoto)}>
                  <Ionicons name="trash-outline" size={16} color="#ef4444" />
                  <Text style={styles.unsaveBtnText}>REMOVE FROM MOODBOARD</Text>
                </Pressable>
              </View>
            </SafeAreaView>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    paddingBottom: 110,
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerSubtitle: {
    fontSize: 9,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 2,
    color: '#888888',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: FONT_FUTURA_BOLD,
    letterSpacing: 1.5,
    color: '#111111',
    marginBottom: 6,
  },
  headerDesc: {
    fontSize: 13,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
    lineHeight: 18,
  },
  filterPillsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  filterPillActive: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  filterPillText: {
    fontSize: 9,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    letterSpacing: 1,
    color: '#555555',
  },
  filterPillTextActive: {
    color: '#ffffff',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.5,
    color: '#111111',
  },
  sectionCount: {
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    color: '#888888',
    letterSpacing: 1,
  },
  centerLoading: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyStateContainer: {
    paddingHorizontal: 30,
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#f8f8f8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#eeeeee',
  },
  emptyTitle: {
    fontSize: 14,
    fontFamily: FONT_FUTURA_BOLD,
    letterSpacing: 1.5,
    color: '#111111',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  exploreBtn: {
    backgroundColor: '#111111',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  exploreBtnText: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.2,
  },
  // Featured Story style 2-Column Masonry Grid
  masonryGridContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
  masonryColumn: {
    flex: 1,
    flexDirection: 'column',
    gap: 8,
  },
  masonryCard: {
    width: '100%',
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  masonryImage: {
    width: '100%',
    height: '100%',
  },
  cardBadgeOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeRoleText: {
    color: '#ffffff',
    fontSize: 8,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 0.5,
  },
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
  },
  lightboxSafeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  lightboxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  lightboxTitle: {
    fontSize: 12,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.5,
    color: '#ffffff',
  },
  lightboxCloseBtn: {
    padding: 4,
  },
  lightboxImageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
  },
  lightboxFooter: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  lightboxMeta: {
    gap: 2,
  },
  lightboxSavedByText: {
    fontSize: 13,
    fontFamily: FONT_JOST_MEDIUM,
    color: '#ffffff',
  },
  lightboxDateText: {
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_REGULAR,
    color: '#aaaaaa',
  },
  unsaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  unsaveBtnText: {
    color: '#ef4444',
    fontSize: 9,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 0.8,
  },
});
