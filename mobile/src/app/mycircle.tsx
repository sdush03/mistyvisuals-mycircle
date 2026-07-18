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
    loadStoredAuth,
    setEventDetails,
    logout,
  } = useAuthStore();

  // Load auth state from SecureStore on startup
  useEffect(() => {
    loadStoredAuth();
  }, []);

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
        const res = await api.get(`/api/gallery/public/events/${eventSlug}`);
        const eventData = res.data;
        setEventRequiresPasscode(!!eventData.hasPasscode);
      } catch (err) {
        console.error('Failed to validate event requirements', err);
        // If validation fails (e.g. offline/inactive), default to passcode check to be safe
        setEventRequiresPasscode(true);
      } finally {
        setIsValidatingEvent(false);
      }
    };

    checkEventStatus();
  }, [eventSlug]);

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
        // Strip trailing subpaths if any (e.g. wedding-slug/gallery/photos -> wedding-slug)
        const parts = slug.split('/');
        slug = parts[0];
      } else if (parsed.hostname && parsed.hostname !== 'mycircle.mistyvisuals.com') {
        // Fallback for custom scheme where slug is the hostname (e.g. mycircle://wedding-slug)
        slug = parsed.hostname;
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
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
