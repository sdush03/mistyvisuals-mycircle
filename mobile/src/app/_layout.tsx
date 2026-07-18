import React, { useEffect } from 'react';
import { Image, useColorScheme, StyleSheet, Platform, View, Pressable, Text, Modal, ActivityIndicator } from 'react-native';
import { Tabs, router, useSegments } from 'expo-router';
import { ThemeProvider, DarkTheme, DefaultTheme } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useAuthStore } from '../store/authStore';
import LoginView from '../components/mycircle/LoginView';

// preventAutoHideAsync throws in Expo Go where no native splash is registered
try { SplashScreen.preventAutoHideAsync(); } catch (_) {}

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

  const isCollapsed = useAuthStore((state) => state.isTabBarCollapsed);
  const token = useAuthStore((state) => state.token);
  const isLoading = useAuthStore((state) => state.isLoading);
  const loadStoredAuth = useAuthStore((state) => state.loadStoredAuth);

  // Load persisted session once on mount
  useEffect(() => {
    loadStoredAuth();
  }, []);

  useEffect(() => {
    const hideSplash = async () => {
      try { await SplashScreen.hideAsync(); } catch (_) {}
    };
    const timer = setTimeout(hideSplash, 800);
    return () => clearTimeout(timer);
  }, []);

  // Determine current active tab
  const currentTab = segments[0] === 'mycircle' ? 'mycircle' : 'index';
  const headerHeight = 56 + insets.top;

  // While auth is being restored from SecureStore, show a blank loading screen
  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <Image
          source={require('@/assets/images/logo-black.png')}
          style={styles.loadingLogo}
          resizeMode="contain"
        />
        <ActivityIndicator size="small" color="#8c867e" style={{ marginTop: 32 }} />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        {/* Global Header */}
        <View style={[styles.globalHeader, { height: headerHeight, paddingTop: insets.top }]}>
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

        {/* Custom Animated Floating Tab Bar */}
        <CustomFloatingTabBar
          activeTab={currentTab}
          isCollapsed={isCollapsed}
          bottomInset={insets.bottom}
        />

        {/* ── App-level Login Overlay ──
            Shown as a fullscreen modal whenever the user has no active session.
            The tab content loads in the background so the app feels instant after login. */}
        <Modal
          visible={!token}
          animationType="fade"
          presentationStyle="fullScreen"
          statusBarTranslucent
        >
          <LoginView onSuccess={() => {}} />
        </Modal>
      </View>
    </ThemeProvider>
  );
}

interface CustomTabBarProps {
  activeTab: 'index' | 'mycircle';
  isCollapsed: boolean;
  bottomInset: number;
}

function CustomFloatingTabBar({ activeTab, isCollapsed, bottomInset }: CustomTabBarProps) {
  const targetWidth = isCollapsed ? 120 : 190;
  const widthVal = useSharedValue(190);

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

  const handleTabPress = (tabName: 'index' | 'mycircle') => {
    if (tabName === 'index') {
      router.replace('/');
    } else {
      router.replace('/mycircle');
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
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
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
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerLogo: {
    height: 34,
    width: 160,
    tintColor: '#000000',
  },
});
