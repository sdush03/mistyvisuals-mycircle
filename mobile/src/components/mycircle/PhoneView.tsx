import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

interface PhoneViewProps {
  onSuccess: () => void;
  onCancel?: () => void;
}

export default function PhoneView({ onSuccess, onCancel }: PhoneViewProps) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const profile = useAuthStore((state) => state.profile);
  const eventSlug = useAuthStore((state) => state.eventSlug);
  const updateProfile = useAuthStore((state) => state.updateProfile);

  const handleSubmit = async () => {
    const sanitized = phoneNumber.replace(/\D/g, '');
    if (sanitized.length < 10) {
      Alert.alert('Invalid Phone Number', 'Please enter a valid 10-digit mobile number.');
      return;
    }

    try {
      setIsSubmitting(true);

      const updateUrl = eventSlug
        ? `/api/gallery/public/events/${eventSlug}/phone`
        : `/api/gallery/family/profile/update`;

      const payload = eventSlug
        ? { phoneNumber: sanitized }
        : { phoneNumber: sanitized, name: profile?.name || '' };

      await api.post(updateUrl, payload);
      
      // Update local profile state
      await updateProfile({ phoneNumber: sanitized });
      onSuccess();
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.error || 'Failed to save phone number. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Pressable style={styles.overlay} onPress={onCancel}>
      <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
        {/* Subtle top indicator bar */}
        <View style={styles.topAccentBar} />

        {/* Badge Icon */}
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>📱</Text>
        </View>

        <Text style={styles.title}>VERIFICATION REQUIRED</Text>
        <Text style={styles.subtitle}>
          Enter your 10-digit mobile number so we can notify you when your photos are uploaded.
        </Text>

        <View style={styles.inputContainer}>
          <Text style={styles.countryPrefix}>+91</Text>
          <TextInput
            style={styles.input}
            placeholder="Mobile Number"
            placeholderTextColor="rgba(255, 255, 255, 0.3)"
            keyboardType="phone-pad"
            maxLength={10}
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            editable={!isSubmitting}
          />
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            isSubmitting && styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#000000" />
          ) : (
            <Text style={styles.buttonText}>Continue →</Text>
          )}
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: 'rgba(18, 18, 20, 0.92)',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 16,
  },
  topAccentBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: 20,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 22,
  },
  title: {
    fontSize: 15,
    color: '#ffffff',
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.60)',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  inputContainer: {
    width: '100%',
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  countryPrefix: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 16,
    fontWeight: '600',
    marginRight: 10,
    letterSpacing: 0.5,
  },
  input: {
    flex: 1,
    height: '100%',
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  buttonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
});
