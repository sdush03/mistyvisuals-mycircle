import React, { useState, useRef } from 'react';
import { StyleSheet, View, Text, Pressable, ActivityIndicator, Alert, Image, Linking } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import { FONT_JOST_SEMIBOLD } from '../../constants/fonts';

interface CameraViewProps {
  onSuccess: () => void;
  onCancel?: () => void;
}

export default function CameraViewScreen({ onSuccess, onCancel }: CameraViewProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [showIntro, setShowIntro] = useState(true);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const cameraRef = useRef<any>(null);

  const profile = useAuthStore((state) => state.profile);
  const eventSlug = useAuthStore((state) => state.eventSlug);
  const updateProfile = useAuthStore((state) => state.updateProfile);

  if (!permission) {
    return (
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      </View>
    );
  }

  if (!permission.granted) {
    if (!permission.canAskAgain) {
      return (
        <Pressable style={styles.overlay} onPress={onCancel}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>CAMERA ACCESS BLOCKED</Text>
            <Text style={styles.subtitle}>
              Camera permission was denied. Please enable camera access for this app in your device Settings.
            </Text>
            <View style={styles.divider} />
            <Pressable style={styles.button} onPress={() => Linking.openSettings()}>
              <Text style={styles.buttonText}>Open Settings</Text>
            </Pressable>
            {onCancel && (
              <Pressable style={styles.backBtn} onPress={onCancel}>
                <Text style={styles.backBtnText}>GO BACK</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      );
    }

    return (
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>REGISTER YOUR FACE</Text>
          <Text style={styles.subtitle}>
            We need camera access to take a live selfie for AI face matching.
          </Text>
          <View style={styles.divider} />
          <Pressable style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </Pressable>
          {onCancel && (
            <Pressable style={styles.backBtn} onPress={onCancel}>
              <Text style={styles.backBtnText}>GO BACK</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    );
  }

  // 1. Intro Step — Match Web Instructions Layout
  if (showIntro) {
    return (
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>REGISTER YOUR FACE</Text>
          <Text style={styles.subtitle}>
            Misty Visuals uses AI face matching to instantly find your photos in the wedding gallery.
          </Text>

          <View style={styles.divider} />

          {/* Guide Items */}
          <View style={styles.guideContainer}>
            <View style={styles.guideRow}>
              <Text style={styles.guideIcon}>🕶️</Text>
              <View style={styles.guideTextCol}>
                <Text style={styles.guideTitle}>Remove Accessories</Text>
                <Text style={styles.guideDesc}>Take off sunglasses, hats, or masks.</Text>
              </View>
            </View>

            <View style={styles.guideRow}>
              <Text style={styles.guideIcon}>💡</Text>
              <View style={styles.guideTextCol}>
                <Text style={styles.guideTitle}>Clear Lighting</Text>
                <Text style={styles.guideDesc}>Ensure light faces you directly (avoid backlighting).</Text>
              </View>
            </View>

            <View style={styles.guideRow}>
              <Text style={styles.guideIcon}>😐</Text>
              <View style={styles.guideTextCol}>
                <Text style={styles.guideTitle}>Expression & Angle</Text>
                <Text style={styles.guideDesc}>Look straight into the lens with a neutral face or light smile.</Text>
              </View>
            </View>
          </View>

          <Pressable style={styles.button} onPress={() => setShowIntro(false)}>
            <Text style={styles.buttonText}>Open Camera</Text>
          </Pressable>

          {onCancel && (
            <Pressable style={styles.backBtn} onPress={onCancel}>
              <Text style={styles.backBtnText}>GO BACK</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    );
  }

  const takePicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
        });
        if (photo && photo.uri) {
          setCapturedPhoto(photo.uri);
        }
      } catch (err) {
        console.error('Failed to take picture', err);
        Alert.alert('Error', 'Failed to capture photo. Please try again.');
      }
    }
  };

  const uploadSelfie = async () => {
    try {
      setIsUploading(true);

      if (!capturedPhoto) {
        Alert.alert('No Photo Captured', 'Please take a live selfie before continuing.');
        return;
      }
      
      const formData = new FormData();
      formData.append('selfie', {
        uri: capturedPhoto,
        name: 'selfie.jpg',
        type: 'image/jpeg',
      } as any);

      const uploadUrl = eventSlug
        ? `/api/gallery/public/events/${eventSlug}/selfie`
        : `/api/gallery/family/profile/update`;

      if (!eventSlug) {
        formData.append('phoneNumber', profile?.phoneNumber || '');
        formData.append('name', profile?.name || '');
      }

      await api.post(uploadUrl, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      await updateProfile({ hasSelfie: true });
      onSuccess();
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.error || 'Selfie verification failed. Please try taking another photo.';
      Alert.alert('Verification Failed', msg);
      setCapturedPhoto(null);
    } finally {
      setIsUploading(false);
    }
  };

  // 2. Photo Confirmation Step
  if (capturedPhoto) {
    return (
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>CONFIRM YOUR SELFIE</Text>
          <Text style={styles.subtitle}>
            Ensure your face is clearly visible, well-lit, and centered in the frame.
          </Text>

          <View style={styles.divider} />

          <Image source={{ uri: capturedPhoto }} style={styles.previewImage} />

          {isUploading ? (
            <ActivityIndicator size="large" color="#ffffff" style={styles.loader} />
          ) : (
            <View style={styles.previewBtnContainer}>
              <Pressable style={styles.retakeBtn} onPress={() => setCapturedPhoto(null)}>
                <Text style={styles.retakeBtnText}>Retake</Text>
              </Pressable>

              <Pressable style={styles.confirmBtn} onPress={uploadSelfie}>
                <Text style={styles.confirmBtnText}>Continue →</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    );
  }

  // 3. Live Camera Step
  return (
    <Pressable style={styles.overlay} onPress={onCancel}>
      <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
        <Text style={styles.title}>TAKE A LIVE SELFIE</Text>
        <Text style={styles.subtitle}>
          Look directly at the camera. Live selfie required for facial recognition.
        </Text>

        <View style={styles.divider} />

        <View style={styles.cameraContainer}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="front"
            animateShutter={false}
          />
        </View>

        <Pressable style={styles.captureBtn} onPress={takePicture}>
          <View style={styles.captureInnerCircle} />
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: 'rgba(15, 15, 15, 0.85)',
    borderRadius: 0,
    paddingVertical: 36,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.45,
    shadowRadius: 40,
    elevation: 20,
  },
  title: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '500',
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: 2.5,
  },
  subtitle: {
    fontSize: 12,
    color: '#a3a3a3',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginBottom: 20,
  },
  guideContainer: {
    width: '100%',
    gap: 18,
    marginBottom: 28,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  guideIcon: {
    fontSize: 18,
    marginTop: -2,
  },
  guideTextCol: {
    flex: 1,
  },
  guideTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  guideDesc: {
    fontSize: 11,
    color: '#a3a3a3',
    lineHeight: 15,
  },
  button: {
    width: '100%',
    height: 46,
    backgroundColor: '#ffffff',
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  cameraContainer: {
    width: 220,
    height: 220,
    borderRadius: 110,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    marginBottom: 24,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  captureBtn: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  captureInnerCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#ffffff',
  },
  previewImage: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    marginBottom: 24,
  },
  previewBtnContainer: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  retakeBtn: {
    flex: 1,
    height: 46,
    borderRadius: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  retakeBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  confirmBtn: {
    flex: 2,
    height: 46,
    borderRadius: 0,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  backBtn: {
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  backBtnText: {
    fontSize: 11,
    letterSpacing: 2,
    color: 'rgba(255, 255, 255, 0.4)',
    fontWeight: '500',
  },
  loader: {
    marginVertical: 20,
  },
});
