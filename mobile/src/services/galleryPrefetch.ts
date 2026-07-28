import api, { guestApi } from './api';
import { Image } from 'expo-image';
import { useAuthStore } from '../store/authStore';

export const prefetchEventGalleryData = async (eventSlug: string, passcode?: string | null) => {
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

    // Parallel background prefetch: Event Details & initial photos
    const [eventRes, photosRes] = await Promise.all([
      api.get(`/api/gallery/public/events/${eventSlug}`).catch(() => ({ data: null })),
      guestApi.get(`/api/gallery/public/events/${eventSlug}/photos?limit=60&offset=0`, { headers: eventHeaders }).catch(() => ({ data: [] })),
    ]);

    const details = eventRes.data;
    if (details) {
      const cover = details.coverUrl || details.cover_url || details.bannerUrl;
      if (cover) Image.prefetch(cover);

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

    const mapPhotoItem = (p: any) => {
      const thumbUri = p.thumbnailUrl || p.thumbnail_url || p.r2Url || p.r2_url || p.file_url_mobile || p.file_url || p.url || '';
      const fullUri = p.r2Url || p.r2_url || p.file_url || p.url || thumbUri;
      return {
        id: p.id,
        r2Url: thumbUri,
        uri: thumbUri,
        fullUri: fullUri,
        photoUrl: fullUri,
        width: p.width,
        height: p.height,
        tabName: p.tabName || p.tab_name || null,
        isLiked: typeof p.isLiked === 'boolean' ? p.isLiked : !!(p.likes && p.likes.length > 0),
        likeCount: typeof p.likeCount === 'number' ? p.likeCount : (typeof p.likesCount === 'number' ? p.likesCount : (p._count?.likes || 0)),
      };
    };

    const photosList = photosRes.data?.photos || (Array.isArray(photosRes.data) ? photosRes.data : []);
    const mappedPhotos = Array.isArray(photosList) ? photosList.map(mapPhotoItem) : [];
    const totalCount = typeof photosRes.data?.total === 'number' ? photosRes.data.total : mappedPhotos.length;

    if (mappedPhotos.length > 0) {
      mappedPhotos.slice(0, 30).forEach((p: any) => {
        if (p.r2Url) Image.prefetch(p.r2Url);
      });
    }

    useAuthStore.getState().setGalleryCache(eventSlug, {
      details: details || undefined,
      photos: mappedPhotos,
      headers: eventHeaders,
      total: totalCount,
    });
  } catch (err) {
    console.warn('[MYCIRCLE PREFETCH ⚠️] Background prefetch error:', err);
  }
};
