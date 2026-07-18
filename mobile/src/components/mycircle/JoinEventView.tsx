import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TextInput, Pressable, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

const JOINED_EVENTS_KEY = 'joined_events_list';

interface JoinEventViewProps {
  onSuccess: (slug: string, passcode: string | null) => void;
}

export default function JoinEventView({ onSuccess }: JoinEventViewProps) {
  const [eventInput, setEventInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [showScanner, setShowScanner] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  
  const [recentEvents, setRecentEvents] = useState<Array<{ slug: string; title: string; date?: string }>>([]);
  const setEventDetails = useAuthStore((state) => state.setEventDetails);

  // Load recently joined events from local secure store
  useEffect(() => {
    const loadRecentEvents = async () => {
      try {
        const eventsStr = await SecureStore.getItemAsync(JOINED_EVENTS_KEY);
        if (eventsStr) {
          setRecentEvents(JSON.parse(eventsStr));
        }
      } catch (e) {
        console.error('Failed to load recent events', e);
      }
    };
    loadRecentEvents();
  }, []);

  const saveEventToRecent = async (slug: string, title: string) => {
    try {
      const currentList = [...recentEvents];
      const exists = currentList.find((e) => e.slug === slug);
      if (!exists) {
        const newList = [{ slug, title, date: new Date().toISOString() }, ...currentList].slice(0, 10);
        setRecentEvents(newList);
        await SecureStore.setItemAsync(JOINED_EVENTS_KEY, JSON.stringify(newList));
      }
    } catch (e) {
      console.error('Failed to save event to recent list', e);
    }
  };

  const handleJoin = async (slug: string, passcode: string | null) => {
    try {
      setIsSubmitting(true);
      // Validate that the event exists by calling the public event details API
      const res = await api.get(`/api/gallery/public/events/${slug}`);
      const eventData = res.data;
      
      await saveEventToRecent(slug, eventData.title);
      setEventDetails(slug, passcode);
      onSuccess(slug, passcode);
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.error || 'Event not found. Check the code/link and try again.';
      Alert.alert('Event Not Found', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const parseAndJoinUrl = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Check if it's a full URL
    // e.g. https://mycircle.mistyvisuals.com/wedding-slug?code=1234
    // or mycircle://wedding-slug?code=1234
    try {
      if (trimmed.includes('http://') || trimmed.includes('https://') || trimmed.includes('mycircle://')) {
        const urlObj = new URL(trimmed.replace('mycircle://', 'https://'));
        const pathSegments = urlObj.pathname.split('/').filter(Boolean);
        
        // The first segment after the domain is the slug
        // Note: in Next.js structure it could be [slug]/gallery or just [slug]
        const slug = pathSegments[0];
        const passcode = urlObj.searchParams.get('code') || urlObj.searchParams.get('passcode');
        
        if (slug) {
          handleJoin(slug, passcode);
          return;
        }
      }
    } catch (e) {
      console.warn('URL parsing failed, treating as slug/code', e);
    }

    // Check if it's a 6-character alphanumeric invite code
    const codePattern = /^[A-Z0-9]{6}$/i;
    if (codePattern.test(trimmed)) {
      try {
        setIsSubmitting(true);
        const res = await api.get(`/api/gallery/public/lookup-code/${trimmed.toUpperCase()}`);
        if (res.data && res.data.slug) {
          handleJoin(res.data.slug, trimmed.toUpperCase());
          return;
        }
      } catch (err) {
        console.warn('Invite code lookup failed, falling back to slug', err);
      } finally {
        setIsSubmitting(false);
      }
    }

    // Fallback: treat as direct slug
    handleJoin(trimmed, null);
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    setShowScanner(false);
    parseAndJoinUrl(data);
  };

  if (showScanner) {
    if (!cameraPermission) {
      return (
        <View style={styles.container}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      );
    }

    if (!cameraPermission.granted) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Camera Permission Required</Text>
          <Text style={styles.subtitle}>
            We need camera access to scan the Event QR code.
          </Text>
          <Pressable style={styles.button} onPress={requestCameraPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={() => setShowScanner(false)}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Scan Event QR Code</Text>
        <Text style={styles.subtitle}>Align the QR code inside the frame to join the gallery.</Text>
        
        <View style={styles.scannerContainer}>
          <CameraView
            style={styles.scanner}
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            onBarcodeScanned={handleBarCodeScanned}
          />
        </View>

        <Pressable style={styles.cancelBtn} onPress={() => setShowScanner(false)}>
          <Text style={styles.cancelBtnText}>Back to Text Input</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer} style={styles.scrollView}>
      <Text style={styles.title}>Join an Event</Text>
      <Text style={styles.subtitle}>
        Scan the QR code at the event or enter the event link/code below.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Event slug or paste link here"
        placeholderTextColor="rgba(0, 0, 0, 0.4)"
        autoCapitalize="none"
        autoCorrect={false}
        value={eventInput}
        onChangeText={setEventInput}
        editable={!isSubmitting}
      />

      <View style={styles.btnRow}>
        <Pressable
          style={({ pressed }) => [
            styles.scannerBtn,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => setShowScanner(true)}
          disabled={isSubmitting}
        >
          <Text style={styles.scannerBtnText}>Scan QR Code</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.submitBtn,
            pressed && styles.buttonPressed,
            isSubmitting && styles.buttonDisabled,
          ]}
          onPress={() => parseAndJoinUrl(eventInput)}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.submitBtnText}>Join</Text>
          )}
        </Pressable>
      </View>

      {recentEvents.length > 0 && (
        <View style={styles.recentSection}>
          <Text style={styles.recentTitle}>Your Recent Events</Text>
          {recentEvents.map((event) => (
            <Pressable
              key={event.slug}
              style={({ pressed }) => [
                styles.eventItem,
                pressed && styles.eventItemPressed,
              ]}
              onPress={() => handleJoin(event.slug, null)}
              disabled={isSubmitting}
            >
              <Text style={styles.eventItemText}>{event.title}</Text>
              <Text style={styles.eventItemSubtext}>{event.slug}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContainer: {
    padding: 30,
    justifyContent: 'center',
    paddingTop: 80,
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  title: {
    fontSize: 20,
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
    marginBottom: 35,
  },
  input: {
    width: '100%',
    padding: 15,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db',
    color: '#000000',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 20,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 15,
    marginBottom: 40,
    width: '100%',
  },
  scannerBtn: {
    flex: 1,
    padding: 15,
    borderWidth: 1,
    borderColor: '#cccccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  submitBtn: {
    flex: 1,
    padding: 15,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  scannerContainer: {
    width: 280,
    height: 280,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#000000',
    marginBottom: 40,
  },
  scanner: {
    flex: 1,
  },
  cancelBtn: {
    padding: 12,
  },
  cancelBtnText: {
    color: 'rgba(0, 0, 0, 0.5)',
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    backgroundColor: '#000000',
    borderRadius: 5,
    marginTop: 15,
    marginBottom: 15,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  recentSection: {
    width: '100%',
  },
  recentTitle: {
    fontSize: 15,
    color: 'rgba(0, 0, 0, 0.4)',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 15,
  },
  eventItem: {
    width: '100%',
    padding: 15,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    marginBottom: 5,
  },
  eventItemPressed: {
    backgroundColor: '#f3f4f6',
  },
  eventItemText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 3,
  },
  eventItemSubtext: {
    color: 'rgba(0, 0, 0, 0.4)',
    fontSize: 12,
  },
});
