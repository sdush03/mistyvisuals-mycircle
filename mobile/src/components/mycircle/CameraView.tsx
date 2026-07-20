import React, { useState, useRef } from 'react';
import { StyleSheet, View, Text, Pressable, ActivityIndicator, Alert, Image } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

interface CameraViewProps {
  onSuccess: () => void;
}

export default function CameraViewScreen({ onSuccess }: CameraViewProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const cameraRef = useRef<any>(null);

  const profile = useAuthStore((state) => state.profile);
  const eventSlug = useAuthStore((state) => state.eventSlug);
  const updateProfile = useAuthStore((state) => state.updateProfile);

  if (!permission) {
    // Camera permissions are still loading
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  if (!permission.granted) {
    // Camera permissions are not granted yet
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Camera Access Required</Text>
        <Text style={styles.subtitle}>
          We need access to your camera to take a live selfie for facial recognition photo matching.
        </Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </Pressable>
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

      // Update local profile state
      await updateProfile({ hasSelfie: true });
      onSuccess();
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.error || 'Selfie verification failed. Please try taking another photo.';
      Alert.alert('Verification Failed', msg);
      setCapturedPhoto(null); // Reset to capture again
    } finally {
      setIsUploading(false);
    }
  };

  if (capturedPhoto) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Confirm Your Selfie</Text>
        <Text style={styles.subtitle}>
          Ensure your face is clearly visible, well-lit, and centered in the frame.
        </Text>

        <Image source={{ uri: capturedPhoto }} style={styles.previewImage} />

        {isUploading ? (
          <ActivityIndicator size="large" color="#000000" style={styles.loader} />
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
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Take a Live Selfie</Text>
      <Text style={styles.subtitle}>
        Look directly at the camera. Uploading from the gallery is disabled to ensure a live verification.
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
  title: {
    fontSize: 20,
    color: '#000000',
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#4b5563',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 25,
    paddingHorizontal: 10,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    backgroundColor: '#000000',
    borderRadius: 5,
    marginTop: 15,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  cameraContainer: {
    width: 280,
    height: 280,
    borderRadius: 140,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#000000',
    marginBottom: 40,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  captureInnerCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#000000',
  },
  previewImage: {
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 3,
    borderColor: '#000000',
    marginBottom: 40,
  },
  previewBtnContainer: {
    flexDirection: 'row',
    gap: 20,
    width: '100%',
    justifyContent: 'center',
  },
  retakeBtn: {
    flex: 1,
    maxWidth: 130,
    padding: 15,
    borderWidth: 1,
    borderColor: '#cccccc',
    alignItems: 'center',
  },
  retakeBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  confirmBtn: {
    flex: 1,
    maxWidth: 130,
    padding: 15,
    backgroundColor: '#000000',
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  skipBtn: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  skipBtnText: {
    fontFamily: 'System',
    fontSize: 13,
    fontWeight: '600',
    color: '#8c867e',
    letterSpacing: 1,
  },
  loader: {
    marginTop: 20,
  },
});
