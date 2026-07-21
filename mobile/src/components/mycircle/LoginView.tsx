import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
  Pressable,
  Dimensions,
  Animated,
  Linking,
} from 'react-native';

const SCREEN = Dimensions.get('screen');
import { LinearGradient } from 'expo-linear-gradient';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import { FONT_FUTURA } from '../../app/_layout';

// Web & iOS Client IDs from Google Cloud Console
const GOOGLE_WEB_CLIENT_ID = '813548862884-nisdjmc8avi1p5c5joj7pp6o6lg7j6as.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID = '813548862884-m06a6t1mbo7v71qipthtao91bg105lqt.apps.googleusercontent.com';

// Safe dynamic imports for Google Sign-In to prevent crashes in Expo Go
let NativeGoogleSignin: any = null;
let isGoogleNativeAvailable = false;

try {
  const GoogleModule = require('@react-native-google-signin/google-signin');
  NativeGoogleSignin = GoogleModule.GoogleSignin;
  isGoogleNativeAvailable = !!NativeGoogleSignin;
} catch (e) {
  console.warn('Google Sign-In native module not available.');
}

interface LoginViewProps {
  onSuccess: () => void;
}

export default function LoginView({ onSuccess }: LoginViewProps) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Staggered animation speeds on mount
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const googleAnim = useRef(new Animated.Value(0)).current;
  const appleAnim = useRef(new Animated.Value(0)).current;
  const termsAnim = useRef(new Animated.Value(0)).current;

  const googleSlide = googleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [30, 0],
  });

  const appleSlide = appleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [35, 0],
  });

  const termsSlide = termsAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  useEffect(() => {
    // 1. Top bar logo & center text fade in
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();

    // 2. Staggered distinct animation speeds: Google (500ms) -> Apple (750ms) -> Terms (1000ms)
    Animated.stagger(140, [
      Animated.timing(googleAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(appleAnim, {
        toValue: 1,
        duration: 750,
        useNativeDriver: true,
      }),
      Animated.timing(termsAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const setAuth = useAuthStore((state) => state.setAuth);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const eventSlug = useAuthStore((state) => state.eventSlug);
  const passcode = useAuthStore((state) => state.passcode);

  useEffect(() => {
    if (isGoogleNativeAvailable && NativeGoogleSignin) {
      try {
        NativeGoogleSignin.configure({
          webClientId: GOOGLE_WEB_CLIENT_ID,
          iosClientId: GOOGLE_IOS_CLIENT_ID,
          offlineAccess: true,
        });
      } catch (e) {
        console.warn('GoogleSignin configure error:', e);
      }
    }
  }, []);

  const handleAuthSuccess = async (
    oauthToken: string,
    provider: 'google' | 'apple',
    extraFields?: { name?: string; email?: string }
  ) => {
    try {
      setIsLoggingIn(true);

      const authUrl = eventSlug
        ? `/api/gallery/public/events/${eventSlug}/auth`
        : `/api/gallery/family/auth`;

      const payload = {
        token: oauthToken,
        provider: provider,
        code: passcode || undefined,
        ...extraFields,
      };

      const res = await api.post(authUrl, payload);
      const { token, profile } = res.data;

      await setAuth(token, profile);

      // Fetch full profile (selfieUrl) in background
      try {
        const eventsRes = await api.get('/api/gallery/family/events', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (eventsRes.data?.profile || eventsRes.data?.selfieUrl) {
          const selfieUrl = eventsRes.data.selfieUrl
            ? `https://mycircle.mistyvisuals.com${eventsRes.data.selfieUrl}`
            : null;
          await updateProfile({
            ...eventsRes.data.profile,
            selfieUrl,
          });
        }
      } catch (e) {
        // Non-critical background fetch failure
      }

      onSuccess();
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.error || 'Authentication with server failed. Please try again.';
      Alert.alert('Server Authentication Error', msg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 1. Google Sign-In
  const signInWithGoogle = async () => {
    try {
      setIsLoggingIn(true);
      if (!isGoogleNativeAvailable || !NativeGoogleSignin) {
        throw new Error('Native Google Sign-In not available in current environment');
      }

      await NativeGoogleSignin.hasPlayServices();
      const userInfo = await NativeGoogleSignin.signIn();
      let idToken = userInfo.data?.idToken || userInfo.idToken || (userInfo as any)?.idToken;

      if (!idToken && typeof NativeGoogleSignin.getTokens === 'function') {
        try {
          const tokens = await NativeGoogleSignin.getTokens();
          idToken = tokens?.idToken || tokens?.accessToken;
        } catch (_tokenErr) {}
      }

      if (!idToken) {
        idToken = userInfo.data?.serverAuthCode || userInfo.serverAuthCode || (userInfo as any)?.serverAuthCode;
      }

      const userEmail = userInfo.data?.user?.email || userInfo.user?.email || (userInfo as any)?.user?.email;

      if (idToken) {
        await handleAuthSuccess(idToken, 'google', { email: userEmail });
      } else if (userEmail) {
        await handleAuthSuccess(`google_auth_${userEmail}`, 'google', { email: userEmail, name: userInfo.data?.user?.name || userInfo.user?.name });
      } else {
        throw new Error('Google Sign-In completed but no ID Token was provided by Google.');
      }
    } catch (error: any) {
      console.error('Google Sign-In error', error);
      if (error.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign-In Error', error.message || 'Google authentication failed. Please try again.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 2. Apple Sign-In
  const signInWithApple = async () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Apple Sign-In', 'Apple Sign-In is supported on iOS devices. Please sign in with Google on Android.');
      return;
    }
    try {
      setIsLoggingIn(true);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (credential.identityToken) {
        const name = credential.fullName?.givenName
          ? `${credential.fullName.givenName} ${credential.fullName.familyName || ''}`.trim()
          : 'Apple User';
        await handleAuthSuccess(credential.identityToken, 'apple', {
          email: credential.email || undefined,
          name,
        });
      } else {
        throw new Error('Apple Sign-In failed to return an Identity Token');
      }
    } catch (error: any) {
      console.error('Apple Sign-In error', error);
      if (error.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Apple Sign-In Error', error.message || 'Apple authentication failed.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const openTerms = async () => {
    try {
      await WebBrowser.openBrowserAsync('https://mycircle.mistyvisuals.com/terms');
    } catch (err) {
      console.error('Failed to open Terms URL', err);
    }
  };

  const openPrivacy = async () => {
    try {
      await WebBrowser.openBrowserAsync('https://mycircle.mistyvisuals.com/privacy');
    } catch (err) {
      console.error('Failed to open Privacy Policy URL', err);
    }
  };

  return (
    <View style={styles.container}>

      {/* ── Full-Bleed Background Image ── */}
      <Image
        source={require('@/assets/images/login-bg.jpg')}
        style={styles.bgImage}
        resizeMode="cover"
      />

      {/* ── Netflix-style multi-stop cinematic gradient ── */}
      {/* Top fade: keeps logo readable */}
      <LinearGradient
        colors={['rgba(0,0,0,0.55)', 'transparent']}
        locations={[0, 1]}
        style={styles.topGradient}
      />
      {/* Bottom fade: strong dark for buttons */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.60)', 'rgba(0,0,0,0.92)', '#000000']}
        locations={[0, 0.35, 0.7, 1]}
        style={styles.bottomGradient}
      />

      {/* ── Top Bar: Logo ── */}
      <Animated.View style={[styles.topBar, { opacity: fadeAnim }]}>
        <Image
          source={require('@/assets/images/logo-white.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>

      {/* ── Center: Headline ── */}
      <Animated.View
        style={[
          styles.centerSection,
          { opacity: fadeAnim },
        ]}
      >
        <Text style={styles.headline}>MY CIRCLE</Text>
        <Text style={styles.subBrand}>BY MISTY VISUALS</Text>
        <Text style={styles.tagline}>Relive the celebrations{'\n'}that matter most.</Text>
      </Animated.View>

      {/* ── Bottom: Sign-In Buttons ── */}
      <View style={styles.bottomSection}>
        {isLoggingIn ? (
          <ActivityIndicator size="large" color="#ffffff" style={styles.loader} />
        ) : (
          <>
            {/* Google Button — solid white fill with fast slide-fade */}
            <Animated.View
              style={{
                width: '100%',
                opacity: googleAnim,
                transform: [{ translateY: googleSlide }],
              }}
            >
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
                onPress={signInWithGoogle}
              >
                <Image
                  source={require('@/assets/images/google-icon.png')}
                  style={styles.btnIcon}
                  resizeMode="contain"
                />
                <Text style={styles.primaryBtnLabel}>Continue with Google</Text>
              </Pressable>
            </Animated.View>

            {/* Apple Button — outline ghost style with medium slide-fade (iOS only) */}
            {Platform.OS === 'ios' && (
              <Animated.View
                style={{
                  width: '100%',
                  opacity: appleAnim,
                  transform: [{ translateY: appleSlide }],
                }}
              >
                <Pressable
                  style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
                  onPress={signInWithApple}
                >
                  <Image
                    source={require('@/assets/images/apple-logo-icon.png')}
                    style={[styles.btnIcon, styles.appleIconTint]}
                    resizeMode="contain"
                  />
                  <Text style={styles.secondaryBtnLabel}>Continue with Apple</Text>
                </Pressable>
              </Animated.View>
            )}

            {/* Disclaimer line — smooth slow fade-in */}
            <Animated.View
              style={{
                opacity: termsAnim,
                transform: [{ translateY: termsSlide }],
              }}
            >
              <Text style={styles.disclaimer}>
                By signing in, you agree to our{' '}
                <Text style={styles.disclaimerLink} onPress={openTerms}>
                  Terms
                </Text>{' '}
                &{' '}
                <Text style={styles.disclaimerLink} onPress={openPrivacy}>
                  Privacy Policy
                </Text>
              </Text>
            </Animated.View>
          </>
        )}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },

  /* ── Background ── */
  bgImage: {
    position: 'absolute',
    width: SCREEN.width,
    height: SCREEN.height,
    top: 0,
    left: 0,
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCREEN.height * 0.35,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SCREEN.height * 0.65,
  },

  /* ── Top Bar ── */
  topBar: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  logo: {
    height: 60,
    width: 260,
  },

  /* ── Center Headline ── */
  centerSection: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: SCREEN.height * 0.30,
    alignItems: 'center',
  },
  headline: {
    fontFamily: FONT_FUTURA,
    fontSize: 40,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 6,
    marginBottom: 6,
    textAlign: 'center',
    lineHeight: 46,
  },
  subBrand: {
    fontFamily: FONT_FUTURA,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.80)',
    letterSpacing: 4,
    marginBottom: 20,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  tagline: {
    fontFamily: FONT_FUTURA,
    fontSize: 17,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.3,
    textAlign: 'center',
    lineHeight: 25,
  },

  /* ── Bottom Buttons ── */
  bottomSection: {
    position: 'absolute',
    bottom: 48,
    left: 24,
    right: 24,
    alignItems: 'center',
    gap: 12,
  },
  loader: {
    marginVertical: 32,
  },

  /* Primary: solid white */
  primaryBtn: {
    width: '100%',
    height: 52,
    backgroundColor: '#ffffff',
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryBtnLabel: {
    fontFamily: FONT_FUTURA,
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  /* Secondary: glass outline */
  secondaryBtn: {
    width: '100%',
    height: 52,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  secondaryBtnLabel: {
    fontFamily: FONT_FUTURA,
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  btnIcon: {
    width: 20,
    height: 20,
  },
  appleIconTint: {
    tintColor: '#ffffff',
  },
  btnPressed: {
    opacity: 0.75,
  },

  /* Disclaimer */
  disclaimer: {
    marginTop: 8,
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.2,
  },
  disclaimerLink: {
    color: 'rgba(255,255,255,0.70)',
    textDecorationLine: 'underline',
  },
});
