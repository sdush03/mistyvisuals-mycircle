import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// In local development, change this to your computer's IP address (e.g. 'http://192.168.1.X:3004')
// when testing on a physical phone via Expo Go.
export const API_BASE_URL = 'https://mycircle.mistyvisuals.com';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Automatically inject authorization header if token exists
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle API error responses — auto-logout only on auth endpoint 401s,
// not on every 401 across the app (e.g. public/family data fetches).
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response && error.response.status === 401) {
      const url: string = error.config?.url || '';
      const isAuthEndpoint =
        url.includes('/api/gallery/family/auth') ||
        url.includes('/api/gallery/public/events') && url.includes('/auth');
      if (isAuthEndpoint) {
        await useAuthStore.getState().logout();
      }
    }
    return Promise.reject(error);
  }
);

export default api;
