import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ActivityIndicator, Alert, SafeAreaView } from 'react-native';
import * as Linking from 'expo-linking';

import { useAuthStore } from '../store/authStore';
import api from '../services/api';

// Sub-components
import LoginView from '../components/mycircle/LoginView';
import PhoneView from '../components/mycircle/PhoneView';
import CameraViewScreen from '../components/mycircle/CameraView';
import JoinEventView from '../components/mycircle/JoinEventView';
import PasscodeView from '../components/mycircle/PasscodeView';
import GalleryView from '../components/mycircle/GalleryView';

export default function MyCircleScreen() {
  const url = Linking.useURL();
  const [eventRequiresPasscode, setEventRequiresPasscode] = useState<boolean | null>(null);
  const [isValidatingEvent, setIsValidatingEvent] = useState(false);

  const {
    token,
    profile,
    isLoading,
    eventSlug,
    passcode,
    setEventDetails,
    logout,
  } = useAuthStore();
  // Note: loadStoredAuth() is already called by _layout.tsx on mount — no need to duplicate here.

  // Parse deep link when it changes
  useEffect(() => {
    if (url) {
      handleDeepLink(url);
    }
  }, [url]);

  // Whenever the eventSlug changes, check if the event requires a passcode
  useEffect(() => {
    const checkEventStatus = async () => {
      if (!eventSlug) {
        setEventRequiresPasscode(null);
        return;
      }

      try {
        setIsValidatingEvent(true);

        // 1. Try exchanging global family session token for event guest token (Seamless SSO)
        const res = await api.post(`/api/gallery/public/events/${eventSlug}/auth-from-family`, {
          code: passcode || undefined,
        });

        if (res.data?.token) {
          // User is authorized for this celebration — bypass passcode screen completely!
          setEventRequiresPasscode(false);
          return;
        }
      } catch (err: any) {
        const errorMsg = err?.response?.data?.error || '';
        if (errorMsg.toLowerCase().includes('passcode')) {
          setEventRequiresPasscode(true);
          return;
        }
      } finally {
        setIsValidatingEvent(false);
      }

      try {
        setIsValidatingEvent(true);
        const res = await api.get(`/api/gallery/public/events/${eventSlug}`);
        const eventData = res.data;
        setEventRequiresPasscode(!!eventData.hasPasscode);
      } catch (err) {
        console.error('Failed to validate event requirements', err);
        setEventRequiresPasscode(false);
      } finally {
        setIsValidatingEvent(false);
      }
    };

    checkEventStatus();
  }, [eventSlug, passcode]);

  const handleDeepLink = (incomingUrl: string) => {
    try {
      const parsed = Linking.parse(incomingUrl);
      
      // Support schemes:
      // 1. mycircle://wedding-slug?code=1234
      // 2. https://mycircle.mistyvisuals.com/wedding-slug?code=1234
      let slug = parsed.path;
      const rawCode = parsed.queryParams?.code || parsed.queryParams?.passcode || null;
      const code = Array.isArray(rawCode) ? rawCode[0] : rawCode;

      if (slug) {
        // Strip trailing subpaths if any
        const parts = slug.split('/');
        slug = parts[0];
      } else if (parsed.hostname && parsed.hostname !== 'mycircle.mistyvisuals.com') {
        // Fallback for custom scheme where slug is hostname (ignore IP addresses & dev hosts)
        const isIpOrDev = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname) || parsed.hostname === 'localhost' || parsed.hostname === 'exp';
        if (!isIpOrDev) {
          slug = parsed.hostname;
        } else {
          slug = null;
        }
      }

      if (slug) {
        setEventDetails(slug, code);
        Alert.alert('Joined Event', `Switched to private event: ${slug}`);
      }
    } catch (err) {
      console.error('Error parsing deep link', err);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: () => logout() },
    ]);
  };

  // State Machine Controller
  if (isLoading || isValidatingEvent) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#000000" />
      </View>
    );
  }

  // 1. Authenticate user
  if (!token) {
    return <LoginView onSuccess={() => {}} />;
  }

  // 2. Set Phone Number (no OTP)
  if (!profile?.phoneNumber) {
    return <PhoneView onSuccess={() => {}} />;
  }

  // 3. Take selfie (mandatory)
  if (!profile?.hasSelfie) {
    return <CameraViewScreen onSuccess={() => {}} />;
  }

  // 4. Select event (if not deep-linked or joined previously)
  if (!eventSlug) {
    return <JoinEventView onSuccess={() => {}} />;
  }

  // 5. Enter passcode if required and we don't have it
  if (eventRequiresPasscode && !passcode) {
    return (
      <PasscodeView
        onSuccess={() => {}}
        onBack={() => setEventDetails(null, null)}
      />
    );
  }

  // 6. Access private photo gallery
  return (
    <GalleryView
      onLogout={handleLogout}
      onChangeEvent={() => setEventDetails(null, null)}
    />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#12100e',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
