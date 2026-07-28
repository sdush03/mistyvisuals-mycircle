import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

interface PhoneViewProps {
  onSuccess: () => void;
  onCancel?: () => void;
}

const COUNTRY_CODES = [
  { code: '+91', country: 'India' },
  { code: '+1', country: 'USA / Canada' },
  { code: '+44', country: 'UK' },
  { code: '+971', country: 'UAE' },
  { code: '+61', country: 'Australia' },
  { code: '+65', country: 'Singapore' },
];

export default function PhoneView({ onSuccess, onCancel }: PhoneViewProps) {
  const [selectedCountry, setSelectedCountry] = useState(COUNTRY_CODES[0]);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const profile = useAuthStore((state) => state.profile);
  const eventSlug = useAuthStore((state) => state.eventSlug);
  const updateProfile = useAuthStore((state) => state.updateProfile);

  const handleSubmit = async () => {
    const cleanDigits = phoneNumber.replace(/\D/g, '');

    if (!cleanDigits) {
      setErrorMsg('Please enter your 10-digit mobile number');
      return;
    }

    if (selectedCountry.code === '+91') {
      if (cleanDigits.length !== 10 || !/^[6-9]/.test(cleanDigits)) {
        setErrorMsg('Invalid Indian number (must be 10 digits starting with 6-9)');
        return;
      }
    } else {
      if (cleanDigits.length < 7 || cleanDigits.length > 14) {
        setErrorMsg('Please enter a valid mobile number');
        return;
      }
    }

    const fullPhoneNumber = `${selectedCountry.code}${cleanDigits}`;

    try {
      setIsSubmitting(true);
      setErrorMsg('');

      const updateUrl = eventSlug
        ? `/api/gallery/public/events/${eventSlug}/phone`
        : `/api/gallery/family/profile/update`;

      const payload = eventSlug
        ? { phoneNumber: fullPhoneNumber }
        : { phoneNumber: fullPhoneNumber, name: profile?.name || '' };

      await api.post(updateUrl, payload);
      
      // Update local profile state
      await updateProfile({ phoneNumber: fullPhoneNumber });
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

        <View style={[styles.phoneInputRow, !!errorMsg && styles.inputErrorRow]}>
          <Pressable
            style={styles.countryBtn}
            onPress={() => setShowCountryPicker(!showCountryPicker)}
          >
            <Text style={styles.codeText}>{selectedCountry.code}</Text>
            <Text style={styles.chevronText}>▾</Text>
          </Pressable>

          <View style={styles.verticalDivider} />

          <TextInput
            style={styles.inputField}
            placeholder="10-digit number"
            placeholderTextColor="rgba(255, 255, 255, 0.35)"
            keyboardType="number-pad"
            maxLength={10}
            value={phoneNumber}
            onChangeText={(text) => {
              setErrorMsg('');
              setPhoneNumber(text.replace(/\D/g, ''));
            }}
            editable={!isSubmitting}
          />
        </View>

        {showCountryPicker && (
          <View style={styles.pickerDropdown}>
            {COUNTRY_CODES.map((item) => (
              <Pressable
                key={item.code}
                style={[
                  styles.pickerOption,
                  selectedCountry.code === item.code && styles.pickerOptionSelected,
                ]}
                onPress={() => {
                  setSelectedCountry(item);
                  setShowCountryPicker(false);
                }}
              >
                <Text style={styles.optionCountry}>{item.country}</Text>
                <Text style={styles.optionCode}>{item.code}</Text>
              </Pressable>
            ))}
          </View>
        )}

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
  phoneInputRow: {
    width: '100%',
    height: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  inputErrorRow: {
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
    height: '100%',
  },
  flagText: {
    fontSize: 16,
  },
  codeText: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '600',
  },
  chevronText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  verticalDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  inputField: {
    flex: 1,
    height: '100%',
    color: '#ffffff',
    fontSize: 15,
    paddingHorizontal: 14,
    letterSpacing: 1.5,
  },
  pickerDropdown: {
    width: '100%',
    backgroundColor: '#1c1c1e',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: 20,
    marginTop: -10,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  pickerOptionSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  optionFlag: {
    fontSize: 16,
    marginRight: 10,
  },
  optionCountry: {
    flex: 1,
    fontSize: 13,
    color: '#ffffff',
  },
  optionCode: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
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
