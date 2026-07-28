import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

interface PhoneViewProps {
  onSuccess: () => void;
  onCancel?: () => void;
}

export default function PhoneView({ onSuccess, onCancel }: PhoneViewProps) {
  const [phoneNumber, setPhoneNumber] = useState('+91 ');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const profile = useAuthStore((state) => state.profile);
  const eventSlug = useAuthStore((state) => state.eventSlug);
  const updateProfile = useAuthStore((state) => state.updateProfile);

  const handlePhoneChange = (text: string) => {
    setErrorMsg('');
    // Ensure user doesn't accidentally delete the initial '+'
    if (!text.startsWith('+')) {
      setPhoneNumber('+91 ' + text.replace(/\D/g, ''));
    } else {
      setPhoneNumber(text);
    }
  };

  const handleSubmit = async () => {
    const cleanNum = phoneNumber.replace(/[\s\-\(\)]/g, ''); // Keeps '+' if present
    const digitsOnly = cleanNum.replace(/\D/g, '');

    if (!digitsOnly) {
      setErrorMsg('Please enter your mobile number');
      return;
    }

    // Validation logic matching web
    const looksLikeIndian = digitsOnly.length === 10 || 
      (digitsOnly.length === 11 && digitsOnly.startsWith('0')) || 
      (digitsOnly.length === 12 && digitsOnly.startsWith('91'));

    let isValid = false;
    let finalFormatted = cleanNum;

    if (looksLikeIndian) {
      isValid = /^(?:91|0)?[6-9]\d{9}$/.test(digitsOnly);
      if (isValid && digitsOnly.length === 10) {
        finalFormatted = `+91${digitsOnly}`;
      } else if (isValid && digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
        finalFormatted = `+${digitsOnly}`;
      }
    } else {
      // International number with country code
      isValid = /^\+[1-9]\d{9,14}$/.test(cleanNum);
    }

    if (!isValid) {
      if (digitsOnly.length === 10 && !/^[6-9]/.test(digitsOnly)) {
        setErrorMsg('Indian numbers must start with 6, 7, 8, or 9.');
      } else {
        setErrorMsg('Please enter a valid mobile number (e.g. +91 9876543210)');
      }
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg('');

      const updateUrl = eventSlug
        ? `/api/gallery/public/events/${eventSlug}/phone`
        : `/api/gallery/family/profile/update`;

      const payload = eventSlug
        ? { phoneNumber: finalFormatted }
        : { phoneNumber: finalFormatted, name: profile?.name || '' };

      await api.post(updateUrl, payload);
      
      // Update local profile state
      await updateProfile({ phoneNumber: finalFormatted });
      onSuccess();
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.error || 'Failed to save phone number. Please try again.';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Pressable style={styles.overlay} onPress={onCancel}>
      <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
        <Text style={styles.title}>ENTER YOUR PHONE NUMBER</Text>
        <Text style={styles.subtitle}>
          We will use this to notify you if additional photos of you are uploaded to the gallery.
        </Text>

        <View style={styles.divider} />

        <TextInput
          style={[styles.input, !!errorMsg && styles.inputError]}
          placeholder="+91 9876543210"
          placeholderTextColor="rgba(255, 255, 255, 0.35)"
          keyboardType="phone-pad"
          maxLength={17}
          value={phoneNumber}
          onChangeText={handlePhoneChange}
          editable={!isSubmitting}
        />

        {!!errorMsg && (
          <Text style={styles.errorText}>{errorMsg}</Text>
        )}

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
            <Text style={styles.buttonText}>Continue</Text>
          )}
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
    marginBottom: 24,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginBottom: 24,
  },
  input: {
    width: '100%',
    height: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    color: '#ffffff',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 2,
  },
  inputError: {
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 16,
  },
  button: {
    width: '100%',
    height: 46,
    backgroundColor: '#ffffff',
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  buttonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 2,
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
});
