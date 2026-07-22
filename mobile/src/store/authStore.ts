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
  selfieUrl?: string | null;
  selfieGuestId?: number | null;
  displayRole?: 'BRIDE' | 'GROOM' | 'GUEST';
}

interface AuthState {
  token: string | null;
  profile: GuestProfile | null;
  userEvents: any[];
  isLoading: boolean;
  eventSlug: string | null;
  passcode: string | null;
  eventCoverUrl: string | null;
  eventTitle: string | null;
  isTabBarCollapsed: boolean;
  setTabBarCollapsed: (collapsed: boolean) => void;
  setUserEvents: (events: any[]) => void;
  
  setAuth: (token: string, profile: GuestProfile, userEvents?: any[]) => Promise<void>;
  updateProfile: (profile: Partial<GuestProfile>) => Promise<void>;
  setEventDetails: (slug: string | null, passcode: string | null, coverUrl?: string | null, title?: string | null) => void;
  loadStoredAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  profile: null,
  userEvents: [],
  isLoading: true,
  eventSlug: null,
  passcode: null,
  eventCoverUrl: null,
  eventTitle: null,
  isTabBarCollapsed: false,
  
  setTabBarCollapsed: (collapsed) => set({ isTabBarCollapsed: collapsed }),
  setUserEvents: (events) => set({ userEvents: events }),

  setAuth: async (token, profile, userEvents = []) => {
    try {
      const { selfieUrl, ...persistentProfile } = profile;
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(persistentProfile));
      set({ token, profile, userEvents, isLoading: false });
    } catch (e) {
      console.error('Error saving auth state', e);
    }
  },

  updateProfile: async (updatedFields) => {
    const currentProfile = get().profile;
    if (!currentProfile) return;
    const newProfile = { ...currentProfile, ...updatedFields };
    try {
      const { selfieUrl, ...persistentProfile } = newProfile;
      await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(persistentProfile));
      set({ profile: newProfile });
    } catch (e) {
      console.error('Error updating profile state', e);
    }
  },

  setEventDetails: (eventSlug, passcode, eventCoverUrl = null, eventTitle = null) => {
    set({ eventSlug, passcode, eventCoverUrl, eventTitle });
  },

  loadStoredAuth: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const profileStr = await SecureStore.getItemAsync(PROFILE_KEY);
      const profile = profileStr ? JSON.parse(profileStr) : null;
      set({ token, profile, isLoading: false });
    } catch (e) {
      // SecureStore may fail on simulator builds without keychain entitlements — this is expected.
      console.warn('SecureStore unavailable, starting with no stored session:', e);
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
