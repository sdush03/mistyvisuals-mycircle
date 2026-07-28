import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Image } from 'expo-image';
import api, { guestApi } from '../services/api';

const TOKEN_KEY = 'user_session_token';
const PROFILE_KEY = 'user_profile_data';

const prefetchEventGalleryData = async (eventSlug: string, passcode?: string | null) => {
  if (!eventSlug) return;
  try {
    const familyToken = useAuthStore.getState().token;
    let eventHeaders: Record<string, string> = {};
    try {
      const ssoRes = await api.post(
        `/api/gallery/public/events/${eventSlug}/auth-from-family`,
        { code: passcode || undefined },
        { headers: familyToken ? { Authorization: `Bearer ${familyToken}` } : {} }
      );
      if (ssoRes.data?.token) {
        eventHeaders = { Authorization: `Bearer ${ssoRes.data.token}` };
      } else if (familyToken) {
        eventHeaders = { Authorization: `Bearer ${familyToken}` };
      }
    } catch (e) {
      if (familyToken) {
        eventHeaders = { Authorization: `Bearer ${familyToken}` };
      }
    }

    // Parallel background prefetch: Event Details (tabs & counts) & initial 60 photos
    const [eventRes, photosRes] = await Promise.all([
      api.get(`/api/gallery/public/events/${eventSlug}`).catch(() => ({ data: null })),
      guestApi.get(`/api/gallery/public/events/${eventSlug}/photos?limit=60&offset=0`, { headers: eventHeaders }).catch(() => ({ data: [] })),
    ]);

    const details = eventRes.data;
    if (details) {
      const cover = details.coverUrl || details.cover_url || details.bannerUrl;
      if (cover) Image.prefetch(cover);

      // Pre-fetch first page & thumbnails for each ceremony tab in background
      if (Array.isArray(details.tabs)) {
        details.tabs.forEach(async (t: string) => {
          if (!t || typeof t !== 'string') return;
          try {
            const tabRes = await guestApi.get(
              `/api/gallery/public/events/${eventSlug}/photos?limit=60&tab=${encodeURIComponent(t)}`,
              { headers: eventHeaders }
            );
            const tList = tabRes.data?.photos || (Array.isArray(tabRes.data) ? tabRes.data : []);
            if (Array.isArray(tList)) {
              tList.slice(0, 20).forEach((p: any) => {
                const thumb = p.thumbnailUrl || p.thumbnail_url || p.r2Url || p.r2_url || p.file_url;
                if (thumb) Image.prefetch(thumb);
              });
            }
          } catch (e) {}
        });
      }
    }

    const photosList = photosRes.data?.photos || (Array.isArray(photosRes.data) ? photosRes.data : []);
    if (Array.isArray(photosList) && photosList.length > 0) {
      photosList.slice(0, 30).forEach((p: any) => {
        const thumb = p.thumbnailUrl || p.thumbnail_url || p.r2Url || p.r2_url || p.file_url;
        if (thumb) Image.prefetch(thumb);
      });
    }
  } catch (err) {
    console.warn('[MYCIRCLE PREFETCH ⚠️] Background prefetch error:', err);
  }
};

export interface GuestProfile {
  id: number;
  name: string;
  email: string;
  phoneNumber?: string | null;
  hasSelfie?: boolean;
  selfieUrl?: string | null;
  selfieGuestId?: number | null;
  displayRole?: 'BRIDE' | 'GROOM' | 'GUEST';
  hasFullAccess?: boolean;
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
    if (eventCoverUrl) {
      Image.prefetch(eventCoverUrl);
    }
    set({ eventSlug, passcode, eventCoverUrl, eventTitle });
    if (eventSlug) {
      prefetchEventGalleryData(eventSlug, passcode);
    }
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
      // Sign out of Google so the account picker is shown on next sign-in
      try {
        const { GoogleSignin } = require('@react-native-google-signin/google-signin');
        await GoogleSignin.signOut();
      } catch (_) {
        // Native module may not be available in all environments (e.g. Expo Go)
      }
      set({ token: null, profile: null, isLoading: false, eventSlug: null, passcode: null });
    } catch (e) {
      console.error('Error deleting auth state', e);
    }
  },
}));
