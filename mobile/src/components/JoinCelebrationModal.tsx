import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../constants/fonts';

const JOINED_EVENTS_KEY = 'joined_events_list';
const { width, height } = Dimensions.get('window');

export interface JoinCelebrationModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: (slug: string, passcode: string | null) => void;
}

export default function JoinCelebrationModal({
  visible,
  onClose,
  onSuccess,
}: JoinCelebrationModalProps) {
  const [eventInput, setEventInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [recentEvents, setRecentEvents] = useState<Array<{ slug: string; title: string; date?: string }>>([]);

  const setEventDetails = useAuthStore((state) => state.setEventDetails);

  const [modalVisible, setModalVisible] = useState(visible);
  const backdropOpacity = useSharedValue(0);
  const sheetTranslateY = useSharedValue(height);

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      backdropOpacity.value = withTiming(1, { duration: 250 });
      sheetTranslateY.value = withTiming(0, {
        duration: 280,
        easing: Easing.out(Easing.poly(3)),
      });
      loadRecentEvents();
    } else if (modalVisible) {
      backdropOpacity.value = withTiming(0, { duration: 200 });
      sheetTranslateY.value = withTiming(
        height,
        { duration: 220, easing: Easing.in(Easing.poly(3)) },
        () => {
          runOnJS(setModalVisible)(false);
        }
      );
    }
  }, [visible]);

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
      const res = await api.get(`/api/gallery/public/events/${slug}`);
      const eventData = res.data;

      await saveEventToRecent(slug, eventData.title || slug);
      setEventDetails(slug, passcode, eventData.coverPhotoMobileUrl || eventData.coverPhotoUrl, eventData.title);
      
      if (onSuccess) {
        onSuccess(slug, passcode);
      }
      handleClose();
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.error || 'Celebration not found. Please check the code or link.';
      Alert.alert('Celebration Not Found', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const parseAndJoinUrl = async (inputStr: string) => {
    const trimmed = inputStr.trim();
    if (!trimmed) return;

    // 1. Check if full URL containing /celebration/ or /gallery/
    let extractedSlug: string | null = null;
    let extractedPasscode: string | null = null;

    try {
      if (trimmed.includes('http://') || trimmed.includes('https://') || trimmed.includes('/celebration/') || trimmed.includes('/gallery/')) {
        const urlObj = new URL(trimmed.startsWith('http') ? trimmed : `https://mistyvisuals.com${trimmed.startsWith('/') ? '' : '/'}${trimmed}`);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        
        const celIndex = pathParts.findIndex(p => p === 'celebration' || p === 'gallery' || p === 'event');
        if (celIndex !== -1 && pathParts[celIndex + 1]) {
          extractedSlug = pathParts[celIndex + 1];
        }

        extractedPasscode = urlObj.searchParams.get('code') || urlObj.searchParams.get('passcode') || urlObj.searchParams.get('pin');
      }
    } catch (e) {
      console.warn('URL parsing fallback:', e);
    }

    if (extractedSlug) {
      handleJoin(extractedSlug, extractedPasscode);
      return;
    }

    // 2. Check if it looks like a short invite code (e.g. 6 chars like "AB1234")
    if (trimmed.length <= 10 && !trimmed.includes('/')) {
      try {
        setIsSubmitting(true);
        const res = await api.get(`/api/gallery/public/lookup-code/${trimmed.toUpperCase()}`);
        if (res.data && res.data.slug) {
          handleJoin(res.data.slug, trimmed.toUpperCase());
          return;
        }
      } catch (err) {
        console.warn('Invite code lookup failed, treating as slug', err);
      } finally {
        setIsSubmitting(false);
      }
    }

    // 3. Fallback: treat as direct slug
    handleJoin(trimmed, null);
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    setShowScanner(false);
    parseAndJoinUrl(data);
  };

  const handleClose = () => {
    backdropOpacity.value = withTiming(0, { duration: 200 });
    sheetTranslateY.value = withTiming(
      height,
      { duration: 220, easing: Easing.in(Easing.poly(3)) },
      () => {
        runOnJS(setShowScanner)(false);
        runOnJS(setEventInput)('');
        runOnJS(setModalVisible)(false);
        runOnJS(onClose)();
      }
    );
  };

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  if (!modalVisible) return null;

  return (
    <Modal
      visible={modalVisible}
      animationType="none"
      transparent={true}
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlayContainer}>
        {/* Fade-in dark backdrop */}
        <Animated.View style={[styles.modalBackdrop, backdropAnimatedStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        </Animated.View>

        {/* Slide-up lower sheet modal */}
        <Animated.View style={[styles.modalCardContainer, sheetAnimatedStyle]}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalCategory}>MY CIRCLE</Text>
              <Text style={styles.modalTitle}>Join a Celebration</Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={handleClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {showScanner ? (
            /* QR Code Camera View */
            <View style={styles.scannerBody}>
              <Text style={styles.scannerSubtitle}>
                Align the QR code inside the frame to join.
              </Text>
              {!cameraPermission?.granted ? (
                <View style={styles.permContainer}>
                  <Text style={styles.permText}>Camera permission is required to scan QR code.</Text>
                  <Pressable style={styles.primaryBtn} onPress={requestCameraPermission}>
                    <Text style={styles.primaryBtnText}>Grant Permission</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.scannerFrame}>
                  <CameraView
                    style={styles.cameraView}
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={handleBarCodeScanned}
                  />
                </View>
              )}
              <Pressable style={styles.secondaryBtn} onPress={() => setShowScanner(false)}>
                <Text style={styles.secondaryBtnText}>Back to Text Input</Text>
              </Pressable>
            </View>
          ) : (
            /* Main Form View */
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.formBody}>
              <Text style={styles.inputLabel}>
                Scan the event QR code or enter your 6-character invite code / event link.
              </Text>

              <TextInput
                style={styles.textInput}
                placeholder="Enter event code or paste link"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
                value={eventInput}
                onChangeText={setEventInput}
                editable={!isSubmitting}
              />

              <View style={styles.buttonRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => setShowScanner(true)}
                  disabled={isSubmitting}
                >
                  <Text style={styles.secondaryBtnText}>Scan QR Code</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && styles.btnPressed,
                    isSubmitting && styles.btnDisabled,
                  ]}
                  onPress={() => parseAndJoinUrl(eventInput)}
                  disabled={isSubmitting || !eventInput.trim()}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Join Gallery</Text>
                  )}
                </Pressable>
              </View>

              {/* Recent Events */}
              {recentEvents.length > 0 && (
                <View style={styles.recentContainer}>
                  <Text style={styles.recentHeader}>RECENT CELEBRATIONS</Text>
                  {recentEvents.map((item) => (
                    <Pressable
                      key={item.slug}
                      style={({ pressed }) => [
                        styles.recentItem,
                        pressed && styles.recentItemPressed,
                      ]}
                      onPress={() => handleJoin(item.slug, null)}
                      disabled={isSubmitting}
                    >
                      <View>
                        <Text style={styles.recentItemTitle}>{item.title}</Text>
                        <Text style={styles.recentItemSlug}>{item.slug}</Text>
                      </View>
                      <Text style={styles.recentItemArrow}>→</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlayContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(18, 16, 14, 0.75)',
  },
  modalCardContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: height * 0.85,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
  },
  modalCategory: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 9,
    letterSpacing: 2,
    color: '#a07850',
    marginBottom: 4,
  },
  modalTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 22,
    color: '#1c1a18',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f0ea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    color: '#60646c',
    fontFamily: FONT_JOST_SEMIBOLD,
  },
  formBody: {
    paddingBottom: 20,
  },
  inputLabel: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    color: '#60646c',
    lineHeight: 19,
    marginBottom: 16,
  },
  textInput: {
    backgroundColor: '#fbfaf8',
    borderWidth: 1,
    borderColor: '#e5e0d8',
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: '#1c1a18',
    marginBottom: 16,
    fontFamily: FONT_JOST_REGULAR,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#1c1a18',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 12,
    letterSpacing: 1,
    color: '#1c1a18',
    textTransform: 'uppercase',
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: '#1c1a18',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 12,
    letterSpacing: 1,
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  btnPressed: {
    opacity: 0.8,
  },
  btnDisabled: {
    backgroundColor: '#8c867e',
  },
  scannerBody: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  scannerSubtitle: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    color: '#60646c',
    marginBottom: 20,
    textAlign: 'center',
  },
  scannerFrame: {
    width: 240,
    height: 240,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#a07850',
    marginBottom: 24,
  },
  cameraView: {
    flex: 1,
  },
  permContainer: {
    alignItems: 'center',
    padding: 20,
  },
  permText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    color: '#60646c',
    textAlign: 'center',
    marginBottom: 16,
  },
  recentContainer: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0ede8',
    paddingTop: 16,
  },
  recentHeader: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 9,
    letterSpacing: 2,
    color: '#8c867e',
    marginBottom: 12,
  },
  recentItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fbfaf8',
    borderWidth: 1,
    borderColor: '#f0ede8',
    borderRadius: 4,
    marginBottom: 8,
  },
  recentItemPressed: {
    backgroundColor: '#f3f0ea',
  },
  recentItemTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 15,
    color: '#1c1a18',
  },
  recentItemSlug: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10,
    color: '#8c867e',
    marginTop: 2,
  },
  recentItemArrow: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 14,
    color: '#a07850',
  },
});
