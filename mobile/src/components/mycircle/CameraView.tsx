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
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <Text style={styles.title}>Camera Access Blocked</Text>
            <Text style={styles.subtitle}>
              Camera permission was denied. To take your selfie, please enable camera access for this app in your device Settings.
            </Text>
            <Pressable style={styles.button} onPress={() => Linking.openSettings()}>
              <Text style={styles.buttonText}>Open Settings</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          <Text style={styles.title}>Camera Access Required</Text>
          <Text style={styles.subtitle}>
            We need access to your camera to take a live selfie for facial recognition photo matching.
          </Text>
          <Pressable style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </Pressable>
        </View>
      </View>
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

  if (capturedPhoto) {
    return (
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Confirm Your Selfie</Text>
          <Text style={styles.subtitle}>
            Ensure your face is clearly visible, well-lit, and centered in the frame.
          </Text>

          <Image source={{ uri: capturedPhoto }} style={styles.previewImage} />

          {isUploading ? (
            <ActivityIndicator size="large" color="#ffffff" style={styles.loader} />
          ) : (
            <View style={styles.previewBtnContainer}>
              <Pressable style={styles.retakeBtn} onPress={() => setCapturedPhoto(null)}>
                <Text style={styles.retakeBtnText}>Retake</Text>
              </Pressable>

              <Pressable style={styles.confirmBtn} onPress={uploadSelfie}>
                <Text style={styles.confirmBtnText}>Use Photo</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    );
  }

  return (
    <Pressable style={styles.overlay} onPress={onCancel}>
      <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
        <Text style={styles.title}>Take a Live Selfie</Text>
        <Text style={styles.subtitle}>
          Look directly at the camera. Live selfie required for facial recognition.
        </Text>

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
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontSize: 20,
    color: '#ffffff',
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.65)',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    paddingHorizontal: 5,
  },
  button: {
    width: '100%',
    height: 48,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cameraContainer: {
    width: 220,
    height: 220,
    borderRadius: 110,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#ffffff',
    marginBottom: 24,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  captureBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  captureInnerCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ffffff',
  },
  previewImage: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 3,
    borderColor: '#ffffff',
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
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  retakeBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  confirmBtn: {
    flex: 1,
    height: 46,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  loader: {
    marginVertical: 20,
  },
});
