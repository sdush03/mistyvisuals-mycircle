import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { savesService, SavedPhotoItem } from '../../services/savesService';
import { useAuthStore, GuestProfile } from '../../store/authStore';
import {
  FONT_FUTURA_BOLD,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';

const { width } = Dimensions.get('window');

interface ProfileViewProps {
  visible: boolean;
  onClose: () => void;
  profile: GuestProfile | null;
  onLogout: () => void;
}

type TabType = 'saves' | 'my_photos';
type FilterType = 'all' | 'mine' | 'partner';

export const ProfileView: React.FC<ProfileViewProps> = ({
  visible,
  onClose,
  profile,
  onLogout,
}) => {
  const insets = useSafeAreaInsets();
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const [activeTab, setActiveTab] = useState<TabType>('saves');
  const [filter, setFilter] = useState<FilterType>('all');
  const [saves, setSaves] = useState<SavedPhotoItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedPhoto, setSelectedPhoto] = useState<SavedPhotoItem | null>(null);

  const fetchSaves = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    const data = await savesService.getSavedPhotos();
    setSaves(data);
    setLoading(false);
  }, [visible]);

  useEffect(() => {
    if (visible) {
      fetchSaves();
    }
  }, [visible, fetchSaves]);

  const handleUnsave = async (item: SavedPhotoItem) => {
    const success = await savesService.unsavePhoto(item.photoUrl, item.id);
    if (success) {
      setSaves((prev) => prev.filter((s) => s.id !== item.id));
      if (selectedPhoto?.id === item.id) {
        setSelectedPhoto(null);
      }
    }
  };

  const filteredSaves = saves.filter((item) => {
    if (filter === 'mine') {
      return item.userId === profile?.id;
    }
    if (filter === 'partner') {
      return item.userId !== profile?.id;
    }
    return true;
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Top Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Account Profile</Text>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>

        {/* User Card */}
        <View style={styles.userSection}>
          {profile?.selfieUrl ? (
            <Image source={{ uri: profile.selfieUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>
                {profile?.name ? profile.name.charAt(0).toUpperCase() : 'U'}
              </Text>
            </View>
          )}
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{profile?.name || 'Circle Member'}</Text>
            {profile?.email ? (
              <Text style={styles.userEmail}>{profile.email}</Text>
            ) : null}

            {/* Admin-assigned Role Badge (Read-only) */}
            {profile?.displayRole === 'BRIDE' ? (
              <View style={styles.roleBadgeContainer}>
                <Text style={styles.roleBadgeTextReadOnly}>👰 Bride</Text>
              </View>
            ) : profile?.displayRole === 'GROOM' ? (
              <View style={styles.roleBadgeContainer}>
                <Text style={styles.roleBadgeTextReadOnly}>🤵 Groom</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Segmented Tab Bar: Saves vs My Photos */}
        <View style={styles.tabContainer}>
          <Pressable
            style={[styles.tabButton, activeTab === 'saves' && styles.activeTabButton]}
            onPress={() => setActiveTab('saves')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'saves' && styles.activeTabText,
              ]}
            >
              Saves ({saves.length})
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabButton, activeTab === 'my_photos' && styles.activeTabButton]}
            onPress={() => setActiveTab('my_photos')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'my_photos' && styles.activeTabText,
              ]}
            >
              My Photos
            </Text>
          </Pressable>
        </View>

        {/* Tab Content */}
        {activeTab === 'saves' ? (
          <View style={styles.savesContainer}>
            {/* Filter Pills */}
            <View style={styles.filterContainer}>
              <Pressable
                style={[styles.filterPill, filter === 'all' && styles.activeFilterPill]}
                onPress={() => setFilter('all')}
              >
                <Text
                  style={[
                    styles.filterText,
                    filter === 'all' && styles.activeFilterText,
                  ]}
                >
                  All Saves
                </Text>
              </Pressable>
              <Pressable
                style={[styles.filterPill, filter === 'mine' && styles.activeFilterPill]}
                onPress={() => setFilter('mine')}
              >
                <Text
                  style={[
                    styles.filterText,
                    filter === 'mine' && styles.activeFilterText,
                  ]}
                >
                  Mine
                </Text>
              </Pressable>
              <Pressable
                style={[styles.filterPill, filter === 'partner' && styles.activeFilterPill]}
                onPress={() => setFilter('partner')}
              >
                <Text
                  style={[
                    styles.filterText,
                    filter === 'partner' && styles.activeFilterText,
                  ]}
                >
                  Partner's
                </Text>
              </Pressable>
            </View>

            {loading ? (
              <ActivityIndicator size="large" color="#000" style={{ marginTop: 40 }} />
            ) : filteredSaves.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyTitle}>No saved photos yet</Text>
                <Text style={styles.emptySub}>
                  Bookmark photos in Featured Stories to curate your event moodboard here!
                </Text>
              </View>
            ) : (
              <FlatList
                data={filteredSaves}
                numColumns={2}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={styles.gridList}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.gridCard}
                    onPress={() => setSelectedPhoto(item)}
                  >
                    <Image
                      source={{ uri: item.photoUrl }}
                      style={styles.gridImage}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                    {/* Source Badge */}
                    <View style={styles.sourceBadge}>
                      <Text style={styles.sourceBadgeText}>
                        {item.savedBy.displayRole === 'BRIDE'
                          ? '👰 Bride'
                          : item.savedBy.displayRole === 'GROOM'
                          ? '🤵 Groom'
                          : item.savedBy.name}
                      </Text>
                    </View>
                  </Pressable>
                )}
              />
            )}
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Event Gallery</Text>
            <Text style={styles.emptySub}>
              Photos matched to you after the event will appear here automatically.
            </Text>
          </View>
        )}

        {/* Footer Actions */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Pressable style={styles.logoutBtn} onPress={onLogout}>
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>
        </View>

        {/* Lightbox Preview for Selected Saved Photo */}
        {selectedPhoto && (
          <Modal
            transparent
            visible
            animationType="fade"
            onRequestClose={() => setSelectedPhoto(null)}
          >
            <View style={styles.lightboxBg}>
              <Pressable style={styles.lightboxClose} onPress={() => setSelectedPhoto(null)}>
                <Text style={styles.lightboxCloseText}>✕</Text>
              </Pressable>
              <Image
                source={{ uri: selectedPhoto.photoUrl }}
                style={styles.lightboxImg}
                contentFit="contain"
              />
              <View style={styles.lightboxBar}>
                <Text style={styles.lightboxAuthor}>
                  Saved by {selectedPhoto.savedBy.displayRole || selectedPhoto.savedBy.name}
                </Text>
                <Pressable
                  style={styles.unsaveBtn}
                  onPress={() => handleUnsave(selectedPhoto)}
                >
                  <Text style={styles.unsaveText}>Remove Save</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF9F6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  headerTitle: {
    fontFamily: FONT_FUTURA_BOLD || 'System',
    fontSize: 18,
    color: '#111',
    letterSpacing: 1,
  },
  closeBtn: {
    padding: 8,
  },
  closeBtnText: {
    fontSize: 18,
    color: '#666',
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  userInfo: {
    marginLeft: 14,
  },
  userName: {
    fontFamily: FONT_JOST_SEMIBOLD || 'System',
    fontSize: 16,
    color: '#111',
  },
  userEmail: {
    fontFamily: FONT_JOST_REGULAR || 'System',
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: '#EAE8E3',
    borderRadius: 25,
    padding: 4,
    marginBottom: 14,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 20,
  },
  activeTabButton: {
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontFamily: FONT_JOST_MEDIUM || 'System',
    fontSize: 14,
    color: '#666',
  },
  activeTabText: {
    color: '#111',
    fontWeight: '600',
  },
  savesContainer: {
    flex: 1,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#EAE8E3',
    marginRight: 8,
  },
  activeFilterPill: {
    backgroundColor: '#111',
  },
  filterText: {
    fontFamily: FONT_JOST_REGULAR || 'System',
    fontSize: 12,
    color: '#444',
  },
  activeFilterText: {
    color: '#FFF',
    fontWeight: '600',
  },
  gridList: {
    paddingHorizontal: 15,
  },
  gridCard: {
    flex: 1,
    margin: 5,
    height: (width - 40) / 2 * 1.3,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#DDD',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  sourceBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  sourceBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontFamily: FONT_JOST_MEDIUM || 'System',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontFamily: FONT_FUTURA_BOLD || 'System',
    fontSize: 16,
    color: '#333',
    marginBottom: 6,
  },
  emptySub: {
    fontFamily: FONT_JOST_REGULAR || 'System',
    fontSize: 13,
    color: '#777',
    textAlign: 'center',
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  logoutBtn: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#EAE8E3',
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
  },
  logoutText: {
    fontFamily: FONT_JOST_SEMIBOLD || 'System',
    fontSize: 14,
    color: '#D93838',
  },
  lightboxBg: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  lightboxCloseText: {
    color: '#FFF',
    fontSize: 22,
  },
  lightboxImg: {
    width: '100%',
    height: '80%',
  },
  lightboxBar: {
    position: 'absolute',
    bottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '90%',
  },
  lightboxAuthor: {
    color: '#FFF',
    fontFamily: FONT_JOST_MEDIUM || 'System',
    fontSize: 14,
  },
  unsaveBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  unsaveText: {
    color: '#FF6B6B',
    fontSize: 12,
    fontWeight: '600',
  },
  roleBadgeContainer: {
    backgroundColor: '#111',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  roleBadgeTextReadOnly: {
    color: '#FFF',
    fontSize: 11,
    fontFamily: FONT_JOST_SEMIBOLD || FONT_JOST_MEDIUM || 'System',
    fontWeight: '600',
  },
});
