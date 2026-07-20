import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

interface PhoneViewProps {
  onSuccess: () => void;
}

export default function PhoneView({ onSuccess }: PhoneViewProps) {
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
    <View style={styles.container}>
      <Text style={styles.title}>Enter Your Phone Number</Text>
      <Text style={styles.subtitle}>
        We will use this to notify you if additional photos of you are uploaded to the gallery.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="10-digit mobile number"
        placeholderTextColor="rgba(0, 0, 0, 0.4)"
        keyboardType="phone-pad"
        maxLength={10}
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        editable={!isSubmitting}
      />

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
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
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
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 1,
  },
  button: {
    width: '100%',
    padding: 15,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
