import React, { useEffect, useState } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  ActivityIndicator, 
  Alert, 
  Platform, 
  Image, 
  Pressable 
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

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

      // Fallback: fetch tokens via getTokens() if idToken is not in initial response
      if (!idToken && typeof NativeGoogleSignin.getTokens === 'function') {
        try {
          const tokens = await NativeGoogleSignin.getTokens();
          idToken = tokens?.idToken || tokens?.accessToken;
        } catch (_tokenErr) {
          // ignore
        }
      }

      // Fallback to serverAuthCode if present
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

  return (
    <View style={styles.container}>
      {/* Full-Screen Background Image (as-is from Login Screen.jpg) */}
      <Image
        source={require('@/assets/images/login-bg.jpg')}
        style={StyleSheet.absoluteFillObject}
        resizeMode="cover"
      />

      {/* Soft Dark Gradient Overlay */}
      <LinearGradient
        colors={['rgba(0, 0, 0, 0.40)', 'rgba(18, 16, 14, 0.65)', 'rgba(12, 10, 8, 0.92)']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Center Section */}
      <View style={styles.centerSection}>
        {/* White Misty Visuals Logo */}
        <Image
          source={require('@/assets/images/logo-white.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        {/* MY CIRCLE */}
        <Text style={styles.appName}>MY CIRCLE</Text>

        {/* Tagline */}
        <Text style={styles.subtextLine}>Relive the celebrations</Text>
        <Text style={styles.subtextLine}>that matter most.</Text>
      </View>

      {/* Bottom Action Section */}
      <View style={styles.bottomSection}>
        {isLoggingIn ? (
          <ActivityIndicator size="large" color="#ffffff" style={styles.loader} />
        ) : (
          <View style={styles.buttonContainer}>

            {/* 1. Google Sign-In Button */}
            <Pressable
              style={({ pressed }) => [styles.googleBtn, pressed && styles.btnPressed]}
              onPress={signInWithGoogle}
            >
              <View style={styles.googleBadge}>
                <Image
                  source={require('@/assets/images/google-icon.png')}
                  style={styles.googleIcon}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.labelWrapper}>
                <Text style={styles.googleBtnLabel}>CONTINUE WITH GOOGLE</Text>
              </View>
              <View style={styles.badgeSpacer} />
            </Pressable>

            {/* 2. Apple Sign-In Button */}
            <Pressable
              style={({ pressed }) => [styles.appleBtn, pressed && styles.btnPressed]}
              onPress={signInWithApple}
            >
              <Image
                source={require('@/assets/images/apple-logo-icon.png')}
                style={styles.appleIcon}
                resizeMode="contain"
              />
              <View style={styles.labelWrapper}>
                <Text style={styles.appleBtnLabel}>CONTINUE WITH APPLE</Text>
              </View>
              <View style={styles.appleIconSpacer} />
            </Pressable>

          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0a08',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 80,
    paddingBottom: 110,
  },
  centerSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  logo: {
    height: 85,
    width: 330,
    marginBottom: 10,
  },
  appName: {
    fontFamily: Platform.OS === 'ios' ? 'Futura' : 'sans-serif-medium',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 5,
    color: '#ffffff',
    marginBottom: 18,
  },
  subtextLine: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.80)',
    fontWeight: '300',
    textAlign: 'center',
    letterSpacing: 0.2,
    lineHeight: 23,
  },
  bottomSection: {
    width: '100%',
    alignItems: 'center',
  },
  loader: {
    marginVertical: 24,
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
    gap: 12,
  },
  btnPressed: {
    opacity: 0.8,
  },

  /* ── 1. Google Button ── */
  googleBtn: {
    width: 280,
    height: 44,
    backgroundColor: '#1f1f20',
    borderRadius: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  googleBadge: {
    width: 38,
    height: 38,
    backgroundColor: '#ffffff',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleIcon: {
    width: 20,
    height: 20,
  },
  labelWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleBtnLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Futura' : 'sans-serif-medium',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1.5,
  },
  badgeSpacer: {
    width: 38,
  },

  /* ── 2. Apple Button ── */
  appleBtn: {
    width: 280,
    height: 44,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.40)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  appleIcon: {
    width: 15,
    height: 18,
    tintColor: '#ffffff',
  },
  appleIconSpacer: {
    width: 15,
  },
  appleBtnLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Futura' : 'sans-serif-medium',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1.5,
  },
});
