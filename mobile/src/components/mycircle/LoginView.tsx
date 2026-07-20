import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Alert, Platform, Image, Pressable } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

// Web & iOS Client IDs from Google Cloud Console
const GOOGLE_WEB_CLIENT_ID = '813548862884-nisdjmc8avi1p5c5joj7pp6o6lg7j6as.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID = '813548862884-m06a6t1mbo7v71qipthtao91bg105lqt.apps.googleusercontent.com';

// Safe dynamic imports for Google Sign-In to prevent crashes in Expo Go
let NativeGoogleSignin: any = null;
let NativeGoogleSigninButton: any = null;
let isGoogleNativeAvailable = false;

try {
  const GoogleModule = require('@react-native-google-signin/google-signin');
  NativeGoogleSignin = GoogleModule.GoogleSignin;
  NativeGoogleSigninButton = GoogleModule.GoogleSigninButton;
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

  const handleAuthSuccess = async (oauthToken: string, provider: 'google' | 'apple') => {
    try {
      setIsLoggingIn(true);
      
      const authUrl = eventSlug
        ? `/api/gallery/public/events/${eventSlug}/auth`
        : `/api/gallery/family/auth`;

      const payload = {
        token: oauthToken,
        provider: provider,
        code: passcode || undefined,
      };

      const res = await api.post(authUrl, payload);
      const { token, profile } = res.data;

      await setAuth(token, profile);

      // Fetch full profile (selfieUrl) from family/events in the background
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
        // Non-critical — profile photo update failed silently
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

  const signInWithGoogle = async () => {
    try {
      setIsLoggingIn(true);
      if (!isGoogleNativeAvailable || !NativeGoogleSignin) {
        throw new Error('Native Google Sign-In not available in current environment');
      }

      await NativeGoogleSignin.hasPlayServices();
      const userInfo = await NativeGoogleSignin.signIn();
      const idToken = userInfo.data?.idToken || userInfo.idToken || (userInfo as any)?.idToken;
      
      if (idToken) {
        await handleAuthSuccess(idToken, 'google');
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

  const signInWithApple = async () => {
    try {
      setIsLoggingIn(true);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      
      if (credential.identityToken) {
        await handleAuthSuccess(credential.identityToken, 'apple');
      } else {
        throw new Error('Apple Sign-In failed to return an Identity Token');
      }
    } catch (error: any) {
      console.error('Apple Sign-In error', error);
      if (error.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Apple Sign-In Error', error.message || 'Apple authentication failed.');
      }
      setIsLoggingIn(false);
    }
  };

  return (
    <View style={styles.container}>
      <Image
        source={require('@/assets/images/logo-black.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      
      <Text style={styles.title}>Welcome to My Circle</Text>
      <Text style={styles.subtitle}>
        Sign in to instantly find your matched photos using AI facial recognition.
      </Text>

      {isLoggingIn ? (
        <ActivityIndicator size="large" color="#000000" style={styles.loader} />
      ) : (
        <View style={styles.buttonContainer}>
          {isGoogleNativeAvailable && NativeGoogleSigninButton ? (
            <NativeGoogleSigninButton
              style={styles.googleButton}
              size={NativeGoogleSigninButton.Size.Wide}
              color={NativeGoogleSigninButton.Color.Light}
              onPress={signInWithGoogle}
            />
          ) : (
            <Pressable style={styles.googleButton} onPress={signInWithGoogle}>
              <Text style={{ color: '#000000', fontWeight: '600' }}>Sign in with Google</Text>
            </Pressable>
          )}

          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              style={styles.appleButton}
              onPress={signInWithApple}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  logo: {
    height: 70,
    width: 250,
    marginBottom: 40,
  },
  title: {
    fontSize: 22,
    color: '#000000',
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#4b5563',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 50,
  },
  loader: {
    marginVertical: 30,
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
    gap: 15,
  },
  googleButton: {
    width: 280,
    height: 48,
  },
  appleButton: {
    width: 280,
    height: 44,
  },
  mockGoogleBtn: {
    width: 280,
    height: 48,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#cccccc',
    // shadow for premium look
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  mockGoogleBtnText: {
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '600',
  },
});
