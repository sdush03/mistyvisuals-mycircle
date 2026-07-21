import React, { useEffect, useState } from 'react';
import { Image, useColorScheme, StyleSheet, Platform, View, Pressable, Text, Modal, ActivityIndicator, StatusBar, BackHandler } from 'react-native';
import { Tabs, router, useSegments } from 'expo-router';
import { ThemeProvider, DarkTheme, DefaultTheme } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Jost_400Regular, Jost_500Medium, Jost_600SemiBold } from '@expo-google-fonts/jost';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useAuthStore } from '../store/authStore';
import api, { API_BASE_URL } from '../services/api';
import LoginView from '../components/mycircle/LoginView';

SplashScreen.preventAutoHideAsync().catch(() => {});

export const FONT_FUTURA = Platform.OS === 'ios' ? 'Futura-Medium' : 'Jost_500Medium';
export const FONT_FUTURA_BOLD = Platform.OS === 'ios' ? 'Futura-Bold' : 'Jost_600SemiBold';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <RootLayoutContent />
    </SafeAreaProvider>
  );
}

function RootLayoutContent() {
  const colorScheme = useColorScheme();
  const segments = useSegments();
  const insets = useSafeAreaInsets();

  const [fontsLoaded] = useFonts({
    Jost_400Regular,
    Jost_500Medium,
    Jost_600SemiBold,
  });

  const [showProfileModal, setShowProfileModal] = useState(false);

  const isCollapsed = useAuthStore((state) => state.isTabBarCollapsed);
  const token = useAuthStore((state) => state.token);
  const profile = useAuthStore((state) => state.profile);
  const isLoading = useAuthStore((state) => state.isLoading);
  const loadStoredAuth = useAuthStore((state) => state.loadStoredAuth);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const logout = useAuthStore((state) => state.logout);

  const [isReady, setIsReady] = useState(false);

  // Load persisted session once on mount
  useEffect(() => {
    async function initialize() {
      try {
        await loadStoredAuth();
      } catch (e) {
        console.warn('Auth initialization error:', e);
      } finally {
        setIsReady(true);
      }
    }
    initialize();
  }, []);

  // Hide the native splash screen as soon as auth and fonts are both resolved.
  // Using useEffect (not onLayout) so it fires on state changes, not just mount.
  useEffect(() => {
    if (isReady && !isLoading && fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isReady, isLoading, fontsLoaded]);

  // Handle Android back button & swipe back gestures globally
  useEffect(() => {
    const onBackPress = () => {
      if (showProfileModal) {
        setShowProfileModal(false);
        return true;
      }
      if (!token) {
        BackHandler.exitApp();
        return true;
      }
      if (segments[0] === 'mycircle') {
        router.replace('/');
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [showProfileModal, token, segments]);

  // Fetch selfie once per session when authenticated.
  // Uses a ref flag so it never reruns due to profile state changes.
  const selfieFetchedRef = React.useRef(false);
  useEffect(() => {
    if (!token) { selfieFetchedRef.current = false; return; }
    if (selfieFetchedRef.current) return;
    selfieFetchedRef.current = true;

    const fetchSelfie = async () => {
      try {
        const res = await api.get('/api/gallery/family/events');
        const rawSelfieUrl: string | null = res.data?.selfieUrl || null;
        const profileData = res.data?.profile || {};

        if (rawSelfieUrl) {
          const fullUrl = `${API_BASE_URL}${rawSelfieUrl}`;
          const imgRes = await fetch(fullUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const selfieUrl = `data:image/jpeg;base64,${btoa(binary)}`;
            await updateProfile({ ...profileData, selfieUrl });
            return;
          }
        }
        await updateProfile({ ...profileData, selfieUrl: null });
      } catch (_err) {
        // 401 or network failure — just mark selfieUrl as null so avatar shows initials
        await updateProfile({ selfieUrl: null }).catch(() => {});
      }
    };

    fetchSelfie();
  }, [token]);

  // Determine current active tab
  const currentTab = segments[0] === 'mycircle' ? 'mycircle' : 'index';
  const topInset = insets.top;
  const headerHeight = 52 + topInset;

  // 1. Keep screen solid black until fonts & stored auth are initialized (prevents flicker)
  if (!isReady || isLoading || !fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
  }

  // 2. Render LoginView directly when unauthenticated (prevents underlying Home screen from mounting/glimpsing)
  if (!token) {
    return <LoginView onSuccess={() => {}} />;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
        {/* Global Header — Centered Logo */}
        <View style={[styles.globalHeader, { height: headerHeight, paddingTop: topInset }]}>
          <Image
            source={require('@/assets/images/logo-black.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
        </View>

        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: { display: 'none' },
          }}
        >
          <Tabs.Screen name="index" />
          <Tabs.Screen name="mycircle" />
        </Tabs>

        {/* Custom Animated Floating Tab Bar (Instagram 3-Tab Style) */}
        <CustomFloatingTabBar
          activeTab={currentTab}
          isCollapsed={isCollapsed}
          bottomInset={insets.bottom}
          profile={profile}
          onOpenProfile={() => setShowProfileModal(true)}
        />

        {/* ── Top Right Profile Details Modal ── */}
        <Modal
          visible={showProfileModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowProfileModal(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setShowProfileModal(false)}>
            <Pressable style={styles.profileCardModal} onPress={(e) => e.stopPropagation()}>
              <View style={styles.profileModalHeader}>
                <Text style={styles.profileModalTitle}>Account Profile</Text>
                <Pressable onPress={() => setShowProfileModal(false)} style={styles.closeBtn}>
                  <Text style={styles.closeBtnText}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.profileInfoSection}>
                {profile?.selfieUrl ? (
                  <Image source={{ uri: profile.selfieUrl }} style={styles.largeAvatarImage} />
                ) : (
                  <View style={styles.largeAvatarCircle}>
                    <Text style={styles.largeAvatarText}>
                      {profile?.name ? profile.name.charAt(0).toUpperCase() : 'U'}
                    </Text>
                  </View>
                )}
                <Text style={styles.profileName}>{profile?.name || 'My Circle Member'}</Text>
                {profile?.email ? <Text style={styles.profileEmail}>{profile.email}</Text> : null}
                {profile?.phoneNumber ? <Text style={styles.profilePhone}>{profile.phoneNumber}</Text> : null}
              </View>

              <Pressable
                style={styles.logoutModalBtn}
                onPress={async () => {
                  setShowProfileModal(false);
                  await logout();
                }}
              >
                <Text style={styles.logoutModalBtnText}>Log Out</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </ThemeProvider>
  );
}

interface CustomTabBarProps {
  activeTab: 'index' | 'mycircle' | 'profile';
  isCollapsed: boolean;
  bottomInset: number;
  profile: any;
  onOpenProfile: () => void;
}

function CustomFloatingTabBar({ activeTab, isCollapsed, bottomInset, profile, onOpenProfile }: CustomTabBarProps) {
  const targetWidth = isCollapsed ? 150 : 285;
  const widthVal = useSharedValue(285);

  useEffect(() => {
    widthVal.value = withSpring(targetWidth, {
      damping: 18,
      stiffness: 150,
      mass: 0.8,
    });
  }, [isCollapsed]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: widthVal.value,
  }));

  const setTabBarCollapsed = useAuthStore((state) => state.setTabBarCollapsed);

  const handleTabPress = (tabName: 'index' | 'mycircle' | 'profile') => {
    setTabBarCollapsed(false);
    if (tabName === 'index') {
      router.replace('/');
    } else if (tabName === 'mycircle') {
      router.replace('/mycircle');
    } else if (tabName === 'profile') {
      onOpenProfile();
    }
  };

  const bottomPosition = bottomInset > 0 ? bottomInset + 10 : 20;

  return (
    <Animated.View style={[styles.floatingTabBar, animatedStyle, { bottom: bottomPosition }]}>
      {/* Home Tab Button */}
      <Pressable
        style={[styles.tabButton, activeTab === 'index' && styles.tabButtonActive]}
        onPress={() => handleTabPress('index')}
      >
        <Image
          source={require('@/assets/images/tabIcons/home.png')}
          style={[
            styles.tabIcon,
            { tintColor: activeTab === 'index' ? '#000000' : 'rgba(0, 0, 0, 0.4)' },
          ]}
          resizeMode="contain"
        />
        {!isCollapsed && (
          <Text
            style={[
              styles.tabLabel,
              { color: activeTab === 'index' ? '#000000' : 'rgba(0, 0, 0, 0.4)' },
            ]}
          >
            Home
          </Text>
        )}
      </Pressable>

      {/* My Circle Tab Button */}
      <Pressable
        style={[styles.tabButton, activeTab === 'mycircle' && styles.tabButtonActive]}
        onPress={() => handleTabPress('mycircle')}
      >
        <Image
          source={require('@/assets/images/tabIcons/explore.png')}
          style={[
            styles.tabIcon,
            { tintColor: activeTab === 'mycircle' ? '#000000' : 'rgba(0, 0, 0, 0.4)' },
          ]}
          resizeMode="contain"
        />
        {!isCollapsed && (
          <Text
            style={[
              styles.tabLabel,
              { color: activeTab === 'mycircle' ? '#000000' : 'rgba(0, 0, 0, 0.4)' },
            ]}
          >
            Circle
          </Text>
        )}
      </Pressable>

      {/* Profile Tab Button (Instagram Style) */}
      <Pressable
        style={[styles.tabButton, activeTab === 'profile' && styles.tabButtonActive]}
        onPress={() => handleTabPress('profile')}
      >
        {profile?.selfieUrl ? (
          <Image
            source={{ uri: profile.selfieUrl }}
            style={[
              styles.tabAvatarImage,
              activeTab === 'profile' && styles.tabAvatarImageActive,
            ]}
          />
        ) : (
          <View
            style={[
              styles.tabAvatarCircle,
              activeTab === 'profile' && styles.tabAvatarCircleActive,
            ]}
          >
            <Text style={styles.tabAvatarText}>
              {profile?.name ? profile.name.charAt(0).toUpperCase() : 'U'}
            </Text>
          </View>
        )}
        {!isCollapsed && (
          <Text
            style={[
              styles.tabLabel,
              { color: activeTab === 'profile' ? '#000000' : 'rgba(0, 0, 0, 0.4)' },
            ]}
          >
            Profile
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingLogo: {
    height: 34,
    width: 160,
    tintColor: '#000000',
  },
  floatingTabBar: {
    position: 'absolute',
    alignSelf: 'center',
    height: 56,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    gap: 5,
  },
  tabButtonActive: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  tabIcon: {
    width: 20,
    height: 20,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  globalHeader: {
    width: '100%',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerLogo: {
    height: 38,
    width: 135,
    tintColor: '#000000',
  },
  tabAvatarImage: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tabAvatarImageActive: {
    borderColor: '#000000',
  },
  tabAvatarCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tabAvatarCircleActive: {
    borderColor: '#000000',
  },
  tabAvatarText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  profileHeaderBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  profileCardModal: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  profileModalHeader: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  profileModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
    letterSpacing: 0.5,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 16,
    color: '#888888',
    fontWeight: '600',
  },
  profileInfoSection: {
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
  },
  largeAvatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  largeAvatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 12,
  },
  largeAvatarText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 13,
    color: '#666666',
    marginBottom: 4,
  },
  profilePhone: {
    fontSize: 13,
    color: '#888888',
    marginTop: 2,
  },
  logoutModalBtn: {
    width: '100%',
    paddingVertical: 12,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    alignItems: 'center',
  },
  logoutModalBtnText: {
    color: '#dc2626',
    fontSize: 14,
    fontWeight: '700',
  },
});
