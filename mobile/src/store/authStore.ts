import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'user_session_token';
const PROFILE_KEY = 'user_profile_data';

export interface GuestProfile {
  id: number;
  name: string;
  email: string;
  phoneNumber?: string | null;
  hasSelfie?: boolean;
}

interface AuthState {
  token: string | null;
  profile: GuestProfile | null;
  isLoading: boolean;
  eventSlug: string | null;
  passcode: string | null;
  isTabBarCollapsed: boolean;
  setTabBarCollapsed: (collapsed: boolean) => void;
  
  setAuth: (token: string, profile: GuestProfile) => Promise<void>;
  updateProfile: (profile: Partial<GuestProfile>) => Promise<void>;
  setEventDetails: (slug: string | null, passcode: string | null) => void;
  loadStoredAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  profile: null,
  isLoading: true,
  eventSlug: null,
  passcode: null,
  isTabBarCollapsed: false,
  
  setTabBarCollapsed: (collapsed) => set({ isTabBarCollapsed: collapsed }),

  setAuth: async (token, profile) => {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile));
      set({ token, profile, isLoading: false });
    } catch (e) {
      console.error('Error saving auth state', e);
    }
  },

  updateProfile: async (updatedFields) => {
    const currentProfile = get().profile;
    if (!currentProfile) return;
    const newProfile = { ...currentProfile, ...updatedFields };
    try {
      await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(newProfile));
      set({ profile: newProfile });
    } catch (e) {
      console.error('Error updating profile state', e);
    }
  },

  setEventDetails: (eventSlug, passcode) => {
    set({ eventSlug, passcode });
  },

  loadStoredAuth: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const profileStr = await SecureStore.getItemAsync(PROFILE_KEY);
      const profile = profileStr ? JSON.parse(profileStr) : null;
      set({ token, profile, isLoading: false });
    } catch (e) {
      console.error('Error loading stored auth state', e);
      set({ isLoading: false });
    }
  },

  logout: async () => {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(PROFILE_KEY);
      set({ token: null, profile: null, isLoading: false, eventSlug: null, passcode: null });
    } catch (e) {
      console.error('Error deleting auth state', e);
    }
  },
}));
