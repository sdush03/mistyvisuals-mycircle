'use client'

import { useState, useEffect, useRef, use, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CameraCaptureModal } from '@/components/CameraCaptureModal'
import { UserAvatarDropdown } from '@/components/UserAvatarDropdown'


type Props = {
  params: Promise<{ slug: string }>
}

export default function GuestGalleryPhotos({ params }: Props) {
  const { slug } = use(params)
  const router = useRouter()
  
  const [event, setEvent] = useState<any>(null)
  const [guest, setGuest] = useState<any>(null)
  const [isProfileSynced, setIsProfileSynced] = useState(false)
  const [photos, setPhotos] = useState<any[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)

  // Helper to fetch selfie image with auth and return a blob URL
  const fetchAuthenticatedSelfie = async (selfieGuestId: number) => {
    const token = localStorage.getItem(`mv_gallery_token_${slug}`)
    if (!token) return
    try {
      const res = await fetch(`${apiUrl}/api/gallery/family/selfie/${selfieGuestId}?t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const blob = await res.blob()
        setSelfiePreview(prev => {
          if (prev && prev.startsWith('blob:')) {
            URL.revokeObjectURL(prev)
          }
          return URL.createObjectURL(blob)
        })
      }
    } catch (err) {
      console.error('Failed to load selfie:', err)
    }
  }

  // Cleanup selfiePreview Blob URL on unmount
  useEffect(() => {
    return () => {
      if (selfiePreview && selfiePreview.startsWith('blob:')) {
        URL.revokeObjectURL(selfiePreview)
      }
    }
  }, [selfiePreview])

  const [activePhoto, setActivePhoto] = useState<any | null>(null)
  const [loadingMatched, setLoadingMatched] = useState(false)

  // Profile states
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [newSelfieFile, setNewSelfieFile] = useState<File | null>(null)
  const [newSelfiePreview, setNewSelfiePreview] = useState<string | null>(null)

  // Cleanup newSelfiePreview Blob URL on unmount or change
  useEffect(() => {
    return () => {
      if (newSelfiePreview && newSelfiePreview.startsWith('blob:')) {
        URL.revokeObjectURL(newSelfiePreview)
      }
    }
  }, [newSelfiePreview])
  const [updatingProfile, setUpdatingProfile] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [phoneValidationError, setPhoneValidationError] = useState<string | null>(null)
  const [shakePhone, setShakePhone] = useState(false)

  const [showCameraCaptureModal, setShowCameraCaptureModal] = useState<boolean>(false)
  const [validationStatus, setValidationStatus] = useState<'idle' | 'verifying' | 'accepted' | 'rejected'>('idle')
  const [selfieError, setSelfieError] = useState('')

  const handleCameraCapture = async (dataUrl: string) => {
    setValidationStatus('verifying')
    setSelfieError('')
    try {
      const blobRes = await fetch(dataUrl)
      const blob = await blobRes.blob()
      const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' })

      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`${apiUrl}/api/gallery/public/validate-face`, {
        method: 'POST',
        body: formData
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to validate face on selfie.')
      }

      setValidationStatus('accepted')
      setNewSelfieFile(file)
      setNewSelfiePreview(dataUrl)
    } catch (err: any) {
      setValidationStatus('rejected')
      setSelfieError(err.message || 'Verification failed. Please retake the photo.')
    }
  }

  useEffect(() => {
    if (!showProfileModal) {
      setValidationStatus('idle')
      setSelfieError('')
      setShowCameraCaptureModal(false)
    }
  }, [showProfileModal])

  // Tabs & Views
  const [viewMode, setViewMode] = useState<'matched' | 'all' | 'favorites'>('all')
  // Per-tab photo cache: tabKey -> { photos[], offset, hasMore }
  const [tabCache, setTabCache] = useState<Record<string, { photos: any[], offset: number, hasMore: boolean }>>({})
  const [loadingMore, setLoadingMore] = useState(false)
  const [totalPhotos, setTotalPhotos] = useState(0)
  const [activeAllTab, setActiveAllTab] = useState<string>('')

  // Derived: photos currently visible in the grid
  const allPhotos = tabCache[activeAllTab]?.photos || []
  const hasMore = tabCache[activeAllTab]?.hasMore ?? true

  // Sentinel ref for IntersectionObserver (infinite scroll trigger)
  const sentinelRef = useRef<HTMLDivElement>(null)


  
  // Masonry layout and Lightbox navigation states
  const [cols, setCols] = useState(4)
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null)
  const [highResLoaded, setHighResLoaded] = useState(false)

  useEffect(() => {
    setHighResLoaded(false)
  }, [activePhotoIndex])

  useEffect(() => {
    const updateCols = () => {
      if (typeof window !== 'undefined') {
        if (window.innerWidth <= 640) setCols(2)
        else if (window.innerWidth <= 1024) setCols(3)
        else setCols(4)
      }
    }
    updateCols()
    window.addEventListener('resize', updateCols)
    return () => window.removeEventListener('resize', updateCols)
  }, [])

  // Track currently active list of photos for dynamic preload & lightbox
  // With pagination, allPhotos is already tab-filtered (fetched with ?tab=) so no client-side filter needed
  const activePhotosList = useMemo(() => {
    if (viewMode === 'matched') {
      return photos || []
    } else if (viewMode === 'all') {
      return allPhotos
    } else if (viewMode === 'favorites') {
      // Favorites come from ALL loaded pages across ALL tabs
      return Object.values(tabCache).flatMap(t => t.photos).filter(p => p.isLiked)
    }
    return []
  }, [viewMode, photos, allPhotos, tabCache])

  const hasFavorites = useMemo(() => {
    return Object.values(tabCache).some(t => t.photos.some(p => p.isLiked));
  }, [tabCache]);

  useEffect(() => {
    if (viewMode === 'favorites' && Object.keys(tabCache).length > 0 && !hasFavorites) {
      setViewMode('all');
    }
  }, [viewMode, tabCache, hasFavorites]);

  // Preload natural aspects (fallback for legacy photos lacking width/height columns)
  useEffect(() => {
    activePhotosList.forEach((photo: any) => {
      const id = photo.id || photo.r2Url
      if (photo.width && photo.height) return
      if (aspects[id]) return
      const img = new Image()
      img.src = photo.r2Url
      img.onload = () => {
        setAspects(prev => {
          if (prev[id] === img.naturalWidth / img.naturalHeight) return prev
          return { ...prev, [id]: img.naturalWidth / img.naturalHeight }
        })
      }
    })
  }, [activePhotosList, aspects])

  // Lightbox keyboard arrows handler
  const handlePrevPhoto = () => {
    if (activePhotoIndex !== null && activePhotoIndex > 0) {
      setActivePhotoIndex(activePhotoIndex - 1)
    }
  }

  const handleNextPhoto = () => {
    if (activePhotoIndex !== null && activePhotoIndex < activePhotosList.length - 1) {
      setActivePhotoIndex(activePhotoIndex + 1)
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activePhotoIndex === null) return
      if (e.key === 'Escape') setActivePhotoIndex(null)
      if (e.key === 'ArrowRight') handleNextPhoto()
      if (e.key === 'ArrowLeft') handlePrevPhoto()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activePhotoIndex, activePhotosList])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (activePhotoIndex !== null) {
        document.documentElement.classList.add('lightbox-open')
        document.body.style.overflow = 'hidden'
      } else {
        document.documentElement.classList.remove('lightbox-open')
        document.body.style.overflow = ''
      }
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('lightbox-open')
        document.body.style.overflow = ''
      }
    }
  }, [activePhotoIndex])

  const getBalancedColumns = (photosList: any[]) => {
    const columns: any[][] = Array.from({ length: cols }, () => [])
    const colHeights = Array(cols).fill(0)

    photosList.forEach((photo, index) => {
      const id = photo.id || photo.r2Url
      const isLandscape = (photo.width && photo.height)
        ? (photo.width / photo.height > 1.1)
        : (aspects[id] ? aspects[id] > 1.1 : false)

      let gridAspect = '2/3'
      if (isLandscape) {
        gridAspect = '3/2'
      } else {
        const cycle = index % 3
        if (cycle === 0) gridAspect = '2/3'
        else if (cycle === 1) gridAspect = '3/4'
        else gridAspect = '4/5'
      }

      const numAspect = isLandscape ? 1.5 : (gridAspect === '2/3' ? 2/3 : (gridAspect === '3/4' ? 3/4 : 4/5))
      const heightContribution = 1 / numAspect

      let shortestIdx = 0
      let minHeight = colHeights[0]
      for (let i = 1; i < cols; i++) {
        if (colHeights[i] < minHeight) {
          minHeight = colHeights[i]
          shortestIdx = i
        }
      }

      columns[shortestIdx].push({
        ...photo,
        _gridAspect: gridAspect
      })
      colHeights[shortestIdx] += heightContribution
    })

    return columns
  }

  const fileInputRef = useRef<HTMLInputElement>(null)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''

  // Derive available tabs directly from event.tabs (no need to scan loaded photos).
  // Hide tabs that have no photos yet only if they've been attempted (hasMore=false, photos=[]).
  // If guest is not full access, only show Highlights.
  const allPhotosTabs = useMemo(() => {
    let tabs: string[] = event?.tabs || []
    if (guest && !guest.hasFullAccess) {
      tabs = tabs.filter((t: string) => t === 'Highlights')
    }
    return tabs
  }, [event, guest])

  useEffect(() => {
    // Check authentication
    const token = localStorage.getItem(`mv_gallery_token_${slug}`)
    const savedGuest = localStorage.getItem(`mv_gallery_guest_${slug}`)
    
    if (!token || !savedGuest) {
      router.push(`/${slug}/gallery`)
      return
    }

    const parsedGuest = JSON.parse(savedGuest)
    if (!parsedGuest.phoneNumber || !parsedGuest.hasSelfie) {
      router.push(`/${slug}/gallery`)
      return
    }

    setGuest(parsedGuest)
    if (parsedGuest.hasSelfie) {
      fetchAuthenticatedSelfie(parsedGuest.id)
    }

    // Auto-upgrade if they landed directly with a code query parameter
    const searchParams = new URLSearchParams(window.location.search)
    const code = searchParams.get('code')

    if (code && !parsedGuest.hasFullAccess) {
      fetch(`${apiUrl}/api/gallery/public/events/${slug}/upgrade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ code })
      })
        .then(res => {
          if (!res.ok) throw new Error('Passcode verification failed')
          return res.json()
        })
        .then(data => {
          localStorage.setItem(`mv_gallery_token_${slug}`, data.token)
          const updatedGuest = {
            ...parsedGuest,
            hasFullAccess: true
          }
          localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(updatedGuest))
          setGuest(updatedGuest)
          setViewMode('all')
          loadAllPhotos('')
        })
        .catch(err => {
          console.warn('Auto-upgrade from URL parameter failed:', err.message)
        })
    }

    if (parsedGuest.hasFullAccess || (code && !parsedGuest.hasFullAccess)) {
      setViewMode('all')
    } else {
      setViewMode('matched')
    }

    // Fetch public event details
    fetch(`${apiUrl}/api/gallery/public/events/${slug}`)
      .then(res => {
        if (!res.ok) throw new Error('Gallery not found')
        return res.json()
      })
      .then(data => {
        setEvent(data)
        // Background-load the first page of photos (empty tab = all tabs)
        loadAllPhotos('')
        // Load matched photos
        loadMatchedPhotos()
      })
      .catch(() => {
        localStorage.removeItem(`mv_gallery_token_${slug}`)
        localStorage.removeItem(`mv_gallery_guest_${slug}`)
        router.push(`/${slug}/gallery`)
      })

    // Sync profile source of truth from database
    fetch(`${apiUrl}/api/gallery/public/events/${slug}/profile`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => {
        if (!res.ok) {
          throw new Error('Session invalid on server')
        }
        return res.json()
      })
      .then(data => {
        if (data && data.profile) {
          const updatedGuest = {
            ...parsedGuest,
            name: data.profile.name,
            phoneNumber: data.profile.phoneNumber,
            hasSelfie: data.profile.hasSelfie,
            hasFullAccess: data.profile.hasFullAccess
          }
          localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(updatedGuest))
          setGuest(updatedGuest)
          
          if (data.profile.selfieGuestId) {
            fetchAuthenticatedSelfie(data.profile.selfieGuestId)
          }

          if (parsedGuest.hasFullAccess !== data.profile.hasFullAccess) {
            setViewMode(data.profile.hasFullAccess ? 'all' : 'matched')
          }
        }
        setIsProfileSynced(true)
      })
      .catch(err => {
        console.error('Failed to sync guest profile, logging out:', err)
        localStorage.removeItem(`mv_gallery_token_${slug}`)
        localStorage.removeItem(`mv_gallery_guest_${slug}`)
        router.push(`/${slug}/gallery`)
      })
  }, [slug, router, apiUrl])

  // Lock body scroll and handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowProfileModal(false)
      }
    }

    if (showProfileModal) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', handleKeyDown)
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showProfileModal])

  const loadMatchedPhotos = async () => {
    setLoadingMatched(true)
    const token = localStorage.getItem(`mv_gallery_token_${slug}`)
    const savedGuest = localStorage.getItem(`mv_gallery_guest_${slug}`)
    const parsedGuest = savedGuest ? JSON.parse(savedGuest) : null

    try {
      const res = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/matched-photos`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!res.ok) throw new Error('Failed to load matched photos')
      const data = await res.json()
      const matchedPhotos = data.photos || []
      setPhotos(matchedPhotos)
      setHasSearched(true)

      // Default to Highlights if they have partial access and no matched photos
      if (matchedPhotos.length === 0 && parsedGuest && !parsedGuest.hasFullAccess) {
        setViewMode('all')
        setActiveAllTab('Highlights')
        loadAllPhotos('Highlights')
      }
    } catch (err) {
      console.error('Failed to load matched photos automatically:', err)
    } finally {
      setLoadingMatched(false)
    }
  }

  const [showHeartPop, setShowHeartPop] = useState(false)
  const heartPopTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleLightboxDoubleTap = async (photoId: number, isCurrentlyLiked: boolean) => {
    if (heartPopTimeoutRef.current) {
      clearTimeout(heartPopTimeoutRef.current)
    }
    setShowHeartPop(true)
    heartPopTimeoutRef.current = setTimeout(() => {
      setShowHeartPop(false)
    }, 800)

    if (!isCurrentlyLiked) {
      await toggleLikeOnPhoto(photoId)
    }
  }

  const lastTapRef = useRef(0)

  const toggleLikeOnPhoto = async (photoId: number) => {
    const token = localStorage.getItem(`mv_gallery_token_${slug}`)
    if (!token) return

    try {
      const res = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/photos/${photoId}/like`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!res.ok) throw new Error('Failed to toggle like')
      const data = await res.json()

      // Update across all cached tabs
      setTabCache(prev => {
        const updated: typeof prev = {}
        for (const tab of Object.keys(prev)) {
          updated[tab] = {
            ...prev[tab],
            photos: prev[tab].photos.map((p: any) =>
              p.id === photoId ? { ...p, isLiked: data.liked, likeCount: data.likeCount } : p
            )
          }
        }
        return updated
      })

      // Update in matched photos state
      setPhotos(prev => prev.map(p => {
        if (p.id === photoId) {
          return { ...p, isLiked: data.liked, likeCount: data.likeCount }
        }
        return p
      }))

    } catch (err) {
      console.error('Like toggle error:', err)
    }
  }

  // Cache-aware paginated photo loader
  // tab: which tab to load. If already fully loaded (hasMore=false), skips.
  const loadAllPhotos = useCallback(async (tab: string) => {
    // Don't double-fetch
    if (loadingMore) return
    const cached = tabCache[tab]
    // Already fully loaded for this tab
    if (cached && !cached.hasMore) return

    const offset = cached?.offset ?? 0
    setLoadingMore(true)
    const token = localStorage.getItem(`mv_gallery_token_${slug}`)
    try {
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const params = new URLSearchParams({ offset: String(offset), limit: '50000', tab })
      const res = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/photos?${params}`, { headers })
      if (!res.ok) throw new Error('Failed to load photos')
      const data = await res.json()
      const newPhotos: any[] = data.photos || []
      const hasMoreFromServer: boolean = data.hasMore ?? false
      // Update total count from first load of any tab
      if (data.total && data.total > 0) setTotalPhotos((prev) => Math.max(prev, data.total))
      setTabCache(prev => ({
        ...prev,
        [tab]: {
          photos: [...(prev[tab]?.photos || []), ...newPhotos],
          offset: offset + newPhotos.length,
          hasMore: hasMoreFromServer
        }
      }))
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, tabCache, slug, apiUrl])

  // IntersectionObserver — fires when sentinel enters the viewport
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore && hasMore) {
          loadAllPhotos(activeAllTab)
        }
      },
      { rootMargin: '400px' } // start loading 400px before sentinel is visible
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadAllPhotos, loadingMore, hasMore, activeAllTab])



  const handleSelfieUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleDownload = async (url: string, filename: string) => {
    if (event && event.allowDownloads === false) {
      alert('Downloads are disabled for this gallery.');
      return;
    }
    try {
      // Force native download via backend download-proxy (setting Content-Disposition header)
      const downloadUrl = `${apiUrl}/api/gallery/public/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (err) {
      console.warn('Proxy download failed, falling back to direct link:', err)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Show preview of selfie
    const reader = new FileReader()
    reader.onloadend = () => {
      setSelfiePreview(reader.result as string)
    }
    reader.readAsDataURL(file)

    setSearching(true)
    setErrorSearch('')
    setViewMode('matched')

    const token = localStorage.getItem(`mv_gallery_token_${slug}`)
    const formData = new FormData()
    formData.append('selfie', file)

    try {
      const res = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      })

      if (!res.ok) throw new Error('Face matching failed. Please try a different photo.')
      const data = await res.json()
      
      setPhotos(data.photos || [])
      setHasSearched(true)
    } catch (err: any) {
      setErrorSearch(err.message)
    } finally {
      setSearching(false)
    }
  }

  const [errorSearch, setErrorSearch] = useState('')

  const handleLogout = () => {
    // Clear ALL gallery and circle tokens — not just current slug
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (
        key?.startsWith('mv_gallery_token_') ||
        key?.startsWith('mv_gallery_guest_') ||
        key === 'mv_circle_token' ||
        key === 'mv_circle_profile'
      ) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k))
    router.push(`/${slug}/gallery`)
  }

  const openProfile = () => {
    if (!guest) return
    setEditName(guest.name || '')
    setEditPhone(guest.phoneNumber || '')
    setNewSelfieFile(null)
    setNewSelfiePreview(null)
    setUpdateError(null)
    setPhoneValidationError(null)
    setShakePhone(false)
    setShowProfileModal(true)
  }

  const handleSelfieChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setNewSelfieFile(file)
      setNewSelfiePreview(URL.createObjectURL(file))
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = localStorage.getItem(`mv_gallery_token_${slug}`)
    if (!token) return

    setUpdatingProfile(true)
    setUpdateError(null)
    setPhoneValidationError(null)

    // Standard phone number validation
    if (editPhone) {
      const cleanNum = editPhone.replace(/[\s\-\(\)\+]/g, '')
      const looksLikeIndian = cleanNum.length === 10 || (cleanNum.length === 11 && cleanNum.startsWith('0')) || (cleanNum.length === 12 && cleanNum.startsWith('91'))
      
      let isValid = false
      if (looksLikeIndian) {
        isValid = /^(?:91|0)?[6-9]\d{9}$/.test(cleanNum)
      } else {
        isValid = /^[1-9]\d{9,14}$/.test(cleanNum)
      }

      if (!isValid) {
        let errorMsg = 'Please enter a valid mobile number (including country code)'
        if (cleanNum.length === 10 && !/^[6-9]/.test(cleanNum)) {
          errorMsg = 'Invalid Indian number (must start with 6-9). For international numbers, add the country code (e.g. +1...)'
        }
        setPhoneValidationError(errorMsg)
        setShakePhone(true)
        setTimeout(() => setShakePhone(false), 400)
        setUpdatingProfile(false)
        return
      }
    }

    try {
      const formData = new FormData()
      formData.append('name', editName)
      formData.append('phoneNumber', editPhone)
      if (newSelfieFile) {
        formData.append('selfie', newSelfieFile)
      }

      const res = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/profile/update`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update profile')
      }

      const data = await res.json()
      // Update local storage guest data
      const updatedGuest = {
        ...guest,
        name: data.profile.name,
        phoneNumber: data.profile.phoneNumber,
        hasSelfie: data.profile.hasSelfie,
        hasFullAccess: data.profile.hasFullAccess !== undefined ? data.profile.hasFullAccess : guest.hasFullAccess
      }
      localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(updatedGuest))
      setGuest(updatedGuest)

      // Re-load selfie image preview URL
      if (data.profile.selfieGuestId) {
        fetchAuthenticatedSelfie(data.profile.selfieGuestId)
      }

      setShowProfileModal(false)
      // Reload matched photos since selfie has changed!
      loadMatchedPhotos()
    } catch (err: any) {
      setUpdateError(err.message)
    } finally {
      setUpdatingProfile(false)
    }
  }



  const renderSkeletons = () => (
    <div style={{ display: 'flex', gap: '12px', width: '100%', padding: '16px clamp(0.75rem, 3vw, 2.5rem) 32px', background: '#fff' }} className="story-masonry">
      {[1, 2, 3].map((colIdx) => {
        const aspects = colIdx === 1 ? ['2/3', '3/4', '2/3'] :
                        colIdx === 2 ? ['3/4', '2/3', '3/4'] :
                                       ['2/3', '2/3', '3/4'];
        return (
          <div key={colIdx} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {aspects.map((aspect, idx) => (
              <div 
                key={idx}
                className="skeleton-card"
                style={{ aspectRatio: aspect }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="relative min-h-screen w-full text-[#111111] flex flex-col justify-between force-light" style={{ colorScheme: 'light', background: '#ffffff' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes heartPop {
          0% { transform: scale(0); opacity: 0; }
          15% { transform: scale(1.2); opacity: 0.9; }
          30% { transform: scale(1); opacity: 0.9; }
          80% { transform: scale(1); opacity: 0.9; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        .animate-heart-pop {
          animation: heartPop 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }
        .gallery-item img {
          opacity: 0;
          transition: opacity 0.5s ease, transform 0.4s ease-out !important;
        }
        .gallery-item img.loaded {
          opacity: 1;
        }
        .gallery-item:hover img.loaded {
          transform: scale(1.02) !important;
        }
        html.lightbox-open,
        html.lightbox-open body {
          overflow: hidden !important;
        }
        #gallery-tabs-row::-webkit-scrollbar {
          display: none;
        }
        #gallery-tabs-row {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .skeleton-card {
          width: 100%;
          background: #eae8e3;
          position: relative;
          overflow: hidden;
          border-radius: 0px;
        }
        .skeleton-card::after {
          content: "";
          position: absolute;
          top: 0; right: 0; bottom: 0; left: 0;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.5) 50%,
            rgba(255, 255, 255, 0) 100%
          );
          transform: translateX(-100%);
          animation: shimmer-anim 1.6s infinite;
        }
        @keyframes shimmer-anim {
          100% {
            transform: translateX(100%);
          }
        }
      `}} />
      
      {/* ── Full-bleed Cover ── */}
      <div style={{
        position: 'relative',
        width: '100%',
        height: '100svh',
        minHeight: '560px',
        overflow: 'hidden',
        background: '#111',
      }}>
        {event?.coverPhotoUrl && (
          <picture>
            {event?.coverPhotoMobileUrl && (
              <source media="(max-width: 767px)" srcSet={encodeURI(event.coverPhotoMobileUrl)} />
            )}
            <img
              src={event.coverPhotoUrl}
              alt={event.title}
              onDragStart={(e) => e.preventDefault()}
              className="pointer-events-none select-none"
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                objectPosition: 'center 30%',
              }}
            />
          </picture>
        )}

        {/* Gradient overlay — bottom-heavy for legibility */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.18) 50%, rgba(0,0,0,0.65) 100%)',
        }} />

        {/* My Circle back link — top left */}
        <Link href="/" style={{
          position: 'absolute', top: 'clamp(1rem, 3.5vw, 2.25rem)', left: 'clamp(1rem, 4vw, 2.5rem)',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: '0.5625rem',
          letterSpacing: '0.25em', textTransform: 'uppercase',
          color: '#fff', textDecoration: 'none',
          fontWeight: 500, opacity: 1,
          transition: 'color 0.2s',
          zIndex: 40,
        }} className="back-link">
          <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <polyline points="5,1 1,5 5,9" /><line x1="1" y1="5" x2="11" y2="5" />
          </svg>
          My Circle
        </Link>

        {/* Brand & Sign Out button — top right */}
        <div style={{
          position: 'absolute', top: 'clamp(1rem, 3.5vw, 2.25rem)', right: 'clamp(1rem, 4vw, 2.5rem)',
          display: 'flex', alignItems: 'center', gap: 'clamp(0.5rem, 2vw, 1rem)',
          zIndex: 40,
        }}>
          <UserAvatarDropdown
            selfieUrl={selfiePreview}
            onProfileClick={openProfile}
            onLogoutClick={handleLogout}
            darkTheme={true}
          />
        </div>

        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: '0 2rem',
          justifyContent: 'center'
        }}>
          <h1 style={{
            fontFamily: '"Futura", "Trebuchet MS", Arial, sans-serif',
            fontSize: 'clamp(1.75rem, 4vw, 3.5rem)',
            fontWeight: 400,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#fff',
            lineHeight: 1.1,
            marginBottom: '1rem',
          }}>
            {(event?.title || '').replace(/'s\s+Wedding/gi, '').replace('&', '').replace(/\s+/g, ' ').trim()}
          </h1>
          {event?.date && (
            <p style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'clamp(0.7rem, 1.1vw, 0.875rem)',
              fontWeight: 500,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#fff',
              marginBottom: '2.5rem',
            }}>
              {new Date(event.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}

          {/* Scroll CTA */}
          <a
            href="#details"
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById('details');
              if (el) {
                el.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            style={{
              display: 'inline-block',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.5625rem',
              fontWeight: 500,
              letterSpacing: '0.25em',
              textTransform: 'uppercase',
              color: '#fff',
              border: '1px solid #fff',
              padding: '0.9rem 2.25rem',
              textDecoration: 'none',
              transition: 'background 0.3s, border-color 0.3s',
            }}
            className="cover-cta"
          >
            View Gallery
          </a>
        </div>

        {/* Photo count — bottom left */}
        {allPhotos.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '1.75rem', left: 'clamp(0.75rem, 3vw, 2.5rem)',
            fontFamily: "'Montserrat', system-ui, sans-serif",
            fontSize: 'clamp(0.5rem, 1vw, 0.5875rem)',
            letterSpacing: '0.22em', color: '#fff',
            textTransform: 'uppercase',
            fontWeight: 300,
            zIndex: 10,
          }}>
            {totalPhotos > 0 ? totalPhotos : allPhotos.length > 0 ? allPhotos.length : ''} {(totalPhotos > 0 || allPhotos.length > 0) ? 'photographs' : ''}
          </div>
        )}

        {/* Logo — static, centred, slightly above the arrow, clickable */}
        <a href="https://www.mistyvisuals.com" target="_blank" rel="noopener noreferrer" style={{
          position: 'absolute', bottom: '4rem', left: '50%',
          transform: 'translateX(-50%)',
          width: '112px', zIndex: 10,
          display: 'block'
        }}>
          <img
            src="/logo-white.png"
            alt="Misty Visuals"
            style={{ width: '100%', display: 'block', opacity: 1 }}
          />
        </a>

        {/* Scroll down chevron */}
        <div className="scroll-chevron" style={{
          position: 'absolute', bottom: '1.75rem', left: '50%', transform: 'translateX(-50%)',
        }}>
          <svg width="14" height="8" viewBox="0 0 14 8" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round">
            <polyline points="1,1 7,7 13,1" />
          </svg>
        </div>
      </div>

      {/* ── Couple Details ── */}
      <div id="details" style={{ 
        background: '#fff', 
        padding: 'clamp(2rem, 4vh, 4rem) clamp(0.75rem, 3vw, 2.5rem)',
        textAlign: 'left',
        maxWidth: '800px',
        margin: '0',
        width: '100%',
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@100..900&display=swap" rel="stylesheet" />
        <h1 style={{
          fontFamily: "'Montserrat', system-ui, sans-serif",
          fontSize: 'clamp(1.25rem, 2.5vw, 2rem)',
          fontWeight: 400,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: '#1c1a18',
          margin: '0 0 0.5rem 0',
          lineHeight: '1.2',
        }}>
          {(event?.title || '').replace(/'s\s+Wedding/gi, '').replace('&', '').replace(/\s+/g, ' ').trim()}
        </h1>
        
        {event?.date && (
          <p style={{
            fontFamily: "'Montserrat', system-ui, sans-serif",
            fontSize: '0.625rem',
            fontWeight: 500,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: '#4a4540',
            margin: '0',
          }}>
            {new Date(event.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        )}
      </div>

      {/* Navigation Tabs */}
      <div id="gallery-tabs" className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-t border-neutral-100 w-full" style={{ padding: '1.5rem 0 0.5rem' }}>
        <div id="gallery-tabs-row" className="flex gap-6 md:gap-12 w-full px-[clamp(0.75rem,3vw,2.5rem)] justify-start overflow-x-auto whitespace-nowrap" style={{ WebkitOverflowScrolling: 'touch' }}>
          {/* ALL Tab */}
          {guest?.hasFullAccess && (
            <button 
              onClick={() => {
                setViewMode('all');
                setActiveAllTab('');
                loadAllPhotos('');
              }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: '0.6875rem',
                letterSpacing: '0.15em', textTransform: 'uppercase',
                color: (viewMode === 'all' && activeAllTab === '') ? '#1c1a18' : '#8c867e',
                paddingBottom: '0.25rem',
                borderBottom: (viewMode === 'all' && activeAllTab === '') ? '1px solid #1c1a18' : '1px solid transparent',
                transition: 'all 0.2s',
                fontWeight: 400,
                flexShrink: 0
              }}
            >
              All
            </button>
          )}

          {/* MY PHOTOS Tab */}
          <button 
            onClick={() => {
              setViewMode('matched');
            }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: '0.6875rem',
              letterSpacing: '0.15em', textTransform: 'uppercase',
              color: viewMode === 'matched' ? '#1c1a18' : '#8c867e',
              paddingBottom: '0.25rem',
              borderBottom: viewMode === 'matched' ? '1px solid #1c1a18' : '1px solid transparent',
              transition: 'all 0.2s',
              fontWeight: 400,
              flexShrink: 0
            }}
          >
            My Photos
          </button>

          {/* MY FAVOURITES Tab */}
          {hasFavorites && (
            <button 
              onClick={() => {
                setViewMode('favorites');
              }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: '0.6875rem',
                letterSpacing: '0.15em', textTransform: 'uppercase',
                color: viewMode === 'favorites' ? '#1c1a18' : '#8c867e',
                paddingBottom: '0.25rem',
                borderBottom: viewMode === 'favorites' ? '1px solid #1c1a18' : '1px solid transparent',
                transition: 'all 0.2s',
                fontWeight: 400,
                flexShrink: 0
              }}
            >
              My Favourites
            </button>
          )}

          {/* Dynamic Event Tabs */}
          {allPhotosTabs.map(tab => (
            <button
              key={tab}
              onClick={() => {
                setViewMode('all');
                setActiveAllTab(tab);
                loadAllPhotos(tab);
              }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: '0.6875rem',
                letterSpacing: '0.15em', textTransform: 'uppercase',
                color: (viewMode === 'all' && activeAllTab === tab) ? '#1c1a18' : '#8c867e',
                paddingBottom: '0.25rem',
                borderBottom: (viewMode === 'all' && activeAllTab === tab) ? '1px solid #1c1a18' : '1px solid transparent',
                transition: 'all 0.2s',
                fontWeight: 400,
                flexShrink: 0
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main Container */}
      <main className="flex-1 w-full pb-8 pt-0 flex flex-col items-stretch">
        {!isProfileSynced ? (
          <div className="py-20 flex flex-col items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#0f172a] border-t-transparent mb-4"></div>
            <p className="font-sans text-xs text-neutral-500">Checking access...</p>
          </div>
        ) : (
          <>
            {/* VIEW MODE: MATCHED */}
            {viewMode === 'matched' && (
          <div className="w-full flex flex-col items-center animate-waterfall">
            {loadingMatched ? (
              renderSkeletons()
            ) : photos.length > 0 ? (
              <div style={{ display: 'flex', gap: '12px', width: '100%', background: '#fff', padding: '16px clamp(0.75rem, 3vw, 2.5rem) 32px' }} className="story-masonry">
                {getBalancedColumns(photos).map((colPhotos, colIdx) => (
                  <div key={colIdx} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {colPhotos.map((p: any) => {
                      const globalIdx = photos.findIndex(item => item.r2Url === p.r2Url)
                      return (
                        <div
                          key={p.r2Url}
                          onClick={() => setActivePhotoIndex(globalIdx)}
                          onContextMenu={(e) => e.preventDefault()}
                          style={{ cursor: 'pointer', overflow: 'hidden', lineHeight: 0, aspectRatio: p._gridAspect || '2/3', position: 'relative', userSelect: 'none', WebkitTouchCallout: 'none' }}
                          className="gallery-item group"
                        >
                          <img src={p.thumbnailUrl || p.r2Url} alt="" loading="lazy" onLoad={(e) => e.currentTarget.classList.add('loaded')} onDragStart={(e) => e.preventDefault()} className="pointer-events-none select-none" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', imageOrientation: 'none' }} />
                          {/* Bottom-Right Controls (Download & Heart/Like) */}
                          <div 
                            className="absolute bottom-3 right-3 z-10 flex items-center gap-3"
                            style={{ transition: 'all 0.2s' }}
                          >
                            {/* Download Button */}
                            {event?.allowDownloads !== false && (
                              <div 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownload(p.r2Url, p.filename);
                                }}
                                className="cursor-pointer select-none opacity-0 group-hover:opacity-100 transition-opacity"
                                style={{ transition: 'all 0.2s' }}
                              >
                                <svg 
                                  className="w-5 h-5" 
                                  viewBox="0 0 24 24" 
                                  fill="none" 
                                  stroke="white" 
                                  strokeWidth="2.2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  style={{ filter: 'drop-shadow(0px 1px 3px rgba(0,0,0,0.85))' }}
                                >
                                  <line x1="12" y1="3" x2="12" y2="16" />
                                  <polyline points="6 10 12 16 18 10" />
                                  <line x1="4" y1="21" x2="20" y2="21" />
                                </svg>
                              </div>
                            )}

                            {/* Heart/Like Badge */}
                            <div 
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleLikeOnPhoto(p.id);
                              }}
                              className={`flex items-center gap-1.5 cursor-pointer select-none ${
                                p.likeCount > 0 || p.isLiked 
                                  ? 'opacity-100' 
                                  : 'opacity-0 group-hover:opacity-100'
                              }`}
                              style={{ transition: 'all 0.2s' }}
                            >
                              {p.isLiked ? (
                                <svg className="w-5 h-5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] fill-current text-red-500" viewBox="0 0 24 24">
                                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                </svg>
                              ) : (
                                <svg 
                                  className="w-5 h-5" 
                                  viewBox="0 0 24 24" 
                                  fill="none" 
                                  stroke="white" 
                                  strokeWidth="2.2"
                                  style={{ filter: 'drop-shadow(0px 1px 3px rgba(0,0,0,0.85))' }}
                                >
                                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                </svg>
                              )}
                              {p.likeCount > 0 && (
                                <span 
                                  style={{ 
                                    color: 'white', 
                                    textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 1px 1px rgba(0,0,0,0.9)',
                                    fontFamily: 'system-ui, sans-serif'
                                  }} 
                                  className="text-xs font-bold"
                                >
                                  {p.likeCount}
                                </span>
                              )}
                            </div>
                          </div>
                          

                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-20">
                <p className="font-lora text-lg text-neutral-600 mb-2">No matching photos found</p>
                <p className="font-sans text-xs text-neutral-400 max-w-xs mx-auto">
                  We couldn't find any photos matching your selfie. If more photos are uploaded later, we'll scan them automatically!
                </p>
              </div>
            )}
          </div>
        )}

        {/* VIEW MODE: MY FAVORITES */}
        {viewMode === 'favorites' && (
          <div className="w-full flex flex-col items-center animate-waterfall">
            {allPhotos.filter(p => p.isLiked).length > 0 ? (
              <div style={{ display: 'flex', gap: '12px', width: '100%', background: '#fff', padding: '16px clamp(0.75rem, 3vw, 2.5rem) 32px' }} className="story-masonry">
                {getBalancedColumns(allPhotos.filter(p => p.isLiked)).map((colPhotos, colIdx) => (
                  <div key={colIdx} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {colPhotos.map((p: any) => {
                      const globalIdx = allPhotos.filter(p => p.isLiked).findIndex(item => item.r2Url === p.r2Url)
                      return (
                        <div
                          key={p.r2Url}
                          onClick={() => setActivePhotoIndex(globalIdx)}
                          onContextMenu={(e) => e.preventDefault()}
                          style={{ cursor: 'pointer', overflow: 'hidden', lineHeight: 0, aspectRatio: p._gridAspect || '2/3', position: 'relative', userSelect: 'none', WebkitTouchCallout: 'none' }}
                          className="gallery-item group"
                        >
                          <img src={p.thumbnailUrl || p.r2Url} alt="" loading="lazy" onLoad={(e) => e.currentTarget.classList.add('loaded')} onDragStart={(e) => e.preventDefault()} className="pointer-events-none select-none" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', imageOrientation: 'none' }} />
                          {/* Bottom-Right Controls (Download & Heart/Like) */}
                          <div 
                            className="absolute bottom-3 right-3 z-10 flex items-center gap-3"
                            style={{ transition: 'all 0.2s' }}
                          >
                            {/* Download Button */}
                            {event?.allowDownloads !== false && (
                              <div 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownload(p.r2Url, p.filename);
                                }}
                                className="cursor-pointer select-none opacity-0 group-hover:opacity-100 transition-opacity"
                                style={{ transition: 'all 0.2s' }}
                              >
                                <svg 
                                  className="w-5 h-5" 
                                  viewBox="0 0 24 24" 
                                  fill="none" 
                                  stroke="white" 
                                  strokeWidth="2.2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  style={{ filter: 'drop-shadow(0px 1px 3px rgba(0,0,0,0.85))' }}
                                >
                                  <line x1="12" y1="3" x2="12" y2="16" />
                                  <polyline points="6 10 12 16 18 10" />
                                  <line x1="4" y1="21" x2="20" y2="21" />
                                </svg>
                              </div>
                            )}

                            {/* Heart/Like Badge */}
                            <div 
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleLikeOnPhoto(p.id);
                              }}
                              className={`flex items-center gap-1.5 cursor-pointer select-none ${
                                p.likeCount > 0 || p.isLiked 
                                  ? 'opacity-100' 
                                  : 'opacity-0 group-hover:opacity-100'
                              }`}
                              style={{ transition: 'all 0.2s' }}
                            >
                              {p.isLiked ? (
                                <svg className="w-5 h-5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] fill-current text-red-500" viewBox="0 0 24 24">
                                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                </svg>
                              ) : (
                                <svg 
                                  className="w-5 h-5" 
                                  viewBox="0 0 24 24" 
                                  fill="none" 
                                  stroke="white" 
                                  strokeWidth="2.2"
                                  style={{ filter: 'drop-shadow(0px 1px 3px rgba(0,0,0,0.85))' }}
                                >
                                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                </svg>
                              )}
                              {p.likeCount > 0 && (
                                <span 
                                  style={{ 
                                    color: 'white', 
                                    textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 1px 1px rgba(0,0,0,0.9)',
                                    fontFamily: 'system-ui, sans-serif'
                                  }} 
                                  className="text-xs font-bold"
                                >
                                  {p.likeCount}
                                </span>
                              )}
                            </div>
                          </div>
                          

                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-20">
                <p className="font-lora text-lg text-neutral-600 mb-2">No favourites selected yet</p>
                <p className="font-sans text-xs text-neutral-400 max-w-xs mx-auto">
                  Double-tap any photo in the viewer to add it to your favourites!
                </p>
              </div>
            )}
          </div>
        )}


        {/* VIEW MODE: BROWSE ALL PHOTOS */}
        {viewMode === 'all' && (
          <div className="w-full flex flex-col items-center animate-waterfall">
            {allPhotos.length === 0 && loadingMore ? (
              renderSkeletons()
            ) : allPhotos.length > 0 ? (
              <>
                {/* Masonry Grid — allPhotos is already tab-filtered by backend */}
                <div style={{ display: 'flex', gap: '12px', width: '100%', background: '#fff', padding: '16px clamp(0.75rem, 3vw, 2.5rem) 32px' }} className="story-masonry">
                  {getBalancedColumns(allPhotos).map((colPhotos, colIdx) => (
                    <div key={colIdx} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {colPhotos.map((p: any) => {
                        const globalIdx = allPhotos.findIndex(item => item.r2Url === p.r2Url)
                        return (
                          <div
                            key={p.r2Url}
                            onClick={() => setActivePhotoIndex(globalIdx)}
                            onContextMenu={(e) => e.preventDefault()}
                            style={{ cursor: 'pointer', overflow: 'hidden', lineHeight: 0, aspectRatio: p._gridAspect || '2/3', position: 'relative', userSelect: 'none', WebkitTouchCallout: 'none' }}
                            className="gallery-item group"
                          >
                            <img src={p.thumbnailUrl || p.r2Url} alt="" loading="lazy" onLoad={(e) => e.currentTarget.classList.add('loaded')} onDragStart={(e) => e.preventDefault()} className="pointer-events-none select-none" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', imageOrientation: 'none' }} />
                            {/* Bottom-Right Controls (Download & Heart/Like) */}
                            <div 
                              className="absolute bottom-3 right-3 z-10 flex items-center gap-3"
                              style={{ transition: 'all 0.2s' }}
                            >
                              {/* Download Button */}
                              {event?.allowDownloads !== false && (
                                <div 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownload(p.r2Url, p.filename);
                                  }}
                                  className="cursor-pointer select-none opacity-0 group-hover:opacity-100 transition-opacity"
                                  style={{ transition: 'all 0.2s' }}
                                >
                                  <svg 
                                    className="w-5 h-5" 
                                    viewBox="0 0 24 24" 
                                    fill="none" 
                                    stroke="white" 
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ filter: 'drop-shadow(0px 1px 3px rgba(0,0,0,0.85))' }}
                                  >
                                    <line x1="12" y1="3" x2="12" y2="16" />
                                    <polyline points="6 10 12 16 18 10" />
                                    <line x1="4" y1="21" x2="20" y2="21" />
                                  </svg>
                                </div>
                              )}

                              {/* Heart/Like Badge */}
                              <div 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleLikeOnPhoto(p.id);
                                }}
                                className={`flex items-center gap-1.5 cursor-pointer select-none ${
                                  p.likeCount > 0 || p.isLiked 
                                    ? 'opacity-100' 
                                    : 'opacity-0 group-hover:opacity-100'
                                }`}
                                style={{ transition: 'all 0.2s' }}
                              >
                                {p.isLiked ? (
                                  <svg className="w-5 h-5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] fill-current text-red-500" viewBox="0 0 24 24">
                                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                  </svg>
                                ) : (
                                  <svg 
                                    className="w-5 h-5" 
                                    viewBox="0 0 24 24" 
                                    fill="none" 
                                    stroke="white" 
                                    strokeWidth="2.2"
                                    style={{ filter: 'drop-shadow(0px 1px 3px rgba(0,0,0,0.85))' }}
                                  >
                                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                  </svg>
                                )}
                                {p.likeCount > 0 && (
                                  <span 
                                    style={{ 
                                      color: 'white', 
                                      textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 1px 1px rgba(0,0,0,0.9)',
                                      fontFamily: 'system-ui, sans-serif'
                                    }} 
                                    className="text-xs font-bold"
                                  >
                                    {p.likeCount}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>

                {/* Infinite scroll sentinel + loading indicator */}
                <div ref={sentinelRef} style={{ width: '100%' }}>
                  {loadingMore && (
                    <div className="flex py-10 items-center justify-center">
                      <div className="h-6 w-6 animate-spin rounded-full border-4 border-solid border-[#0f172a] border-t-transparent"></div>
                    </div>
                  )}
                  {!hasMore && allPhotos.length > 0 && (
                    <div className="text-center py-8" style={{ fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#b0a89e' }}>
                      All photos loaded
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-16">
                <p className="font-lora text-lg text-neutral-600 mb-2">No photos in this gallery</p>
                <p className="font-sans text-xs text-neutral-400">
                  Please upload photos using the desktop uploader script.
                </p>
              </div>
            )}
          </div>
        )}
          </>
        )}
      </main>

      

      {/* Lightbox / View Modal */}
      {activePhotoIndex !== null && activePhotosList[activePhotoIndex] && (
        <div
          role="dialog"
          aria-modal
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(8,6,4,0.97)',
            display: 'flex', flexDirection: 'column',
          }}
          onClick={() => setActivePhotoIndex(null)}
        >
          {/* Top bar — close */}
          <div
            style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '1.25rem 1.5rem', flexShrink: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setActivePhotoIndex(null)}
              aria-label="Close"
              style={{
                width: '38px', height: '38px', borderRadius: '50%',
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.1)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,0.6)', transition: 'background 0.2s',
              }}
              onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
              onMouseOut={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <line x1="1" y1="1" x2="10" y2="10"/><line x1="10" y1="1" x2="1" y2="10"/>
              </svg>
            </button>
          </div>

          {/* Image area */}
          <div
            style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', minHeight: 0 }}
          >
            {/* Prev arrow */}
            {activePhotoIndex > 0 && (
              <button
                onClick={e => { e.stopPropagation(); handlePrevPhoto() }}
                aria-label="Previous"
                style={{
                  position: 'absolute', left: '1.25rem', zIndex: 10,
                  width: '48px', height: '48px', borderRadius: '50%',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'rgba(255,255,255,0.6)', transition: 'background 0.2s', flexShrink: 0,
                }}
                onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
                onMouseOut={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
              >
                <svg width="9" height="15" viewBox="0 0 9 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="8,1 1,7.5 8,14"/>
                </svg>
              </button>
            )}

            {/* Image + heart pop */}
            <div
              style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Blurred thumbnail placeholder visible while high-res loads */}
              {!highResLoaded && (
                <img
                  src={activePhotosList[activePhotoIndex].thumbnailUrl || activePhotosList[activePhotoIndex].r2Url}
                  alt=""
                  onDragStart={(e) => e.preventDefault()}
                  className="pointer-events-none select-none"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    borderRadius: '3px',
                    filter: 'blur(10px)',
                    transform: 'scale(1.02)', // hides raw blur edge bleeding
                    imageOrientation: 'from-image',
                  }}
                />
              )}
              <div style={{ position: 'relative', display: 'block', userSelect: 'none', WebkitTouchCallout: 'none' }}>
                {/* Transparent overlay capturing all pointer events to prevent right click & touch hold menus */}
                <div
                  onDoubleClick={() => handleLightboxDoubleTap(activePhotosList[activePhotoIndex].id, activePhotosList[activePhotoIndex].isLiked)}
                  onTouchEnd={e => {
                    const now = Date.now();
                    if (now - lastTapRef.current < 300) {
                      handleLightboxDoubleTap(activePhotosList[activePhotoIndex].id, activePhotosList[activePhotoIndex].isLiked);
                    }
                    lastTapRef.current = now;
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 10,
                    cursor: 'pointer',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none'
                  }}
                />
                <img
                  src={activePhotosList[activePhotoIndex].r2Url}
                  alt=""
                  onLoad={() => setHighResLoaded(true)}
                  onDragStart={(e) => e.preventDefault()}
                  onContextMenu={(e) => e.preventDefault()}
                  className="pointer-events-none select-none"
                  style={{
                    maxWidth: 'min(88vw, calc(100vw - 160px))',
                    maxHeight: 'calc(100vh - 160px)',
                    objectFit: 'contain',
                    userSelect: 'none',
                    borderRadius: '3px',
                    display: 'block',
                    opacity: highResLoaded ? 1 : 0,
                    transition: 'opacity 0.35s ease',
                    position: 'relative',
                    zIndex: 2,
                    imageOrientation: 'from-image',
                    WebkitTouchCallout: 'none',
                  }}
                />
              </div>
              {showHeartPop && (
                <div
                  className="animate-heart-pop"
                  style={{
                    position: 'absolute', top: '50%', left: '50%',
                    marginTop: '-40px', marginLeft: '-40px',
                    pointerEvents: 'none', color: 'white',
                    filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.35))',
                    zIndex: 350,
                  }}
                >
                  <svg className="w-20 h-20 fill-current text-white/95" viewBox="0 0 24 24">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                </div>
              )}
            </div>

            {/* Next arrow */}
            {activePhotoIndex < activePhotosList.length - 1 && (
              <button
                onClick={e => { e.stopPropagation(); handleNextPhoto() }}
                aria-label="Next"
                style={{
                  position: 'absolute', right: '1.25rem', zIndex: 10,
                  width: '48px', height: '48px', borderRadius: '50%',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'rgba(255,255,255,0.6)', transition: 'background 0.2s', flexShrink: 0,
                }}
                onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
                onMouseOut={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
              >
                <svg width="9" height="15" viewBox="0 0 9 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1,1 8,7.5 1,14"/>
                </svg>
              </button>
            )}
          </div>

          {/* Bottom action bar */}
          <div
            style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '68px',
              background: 'rgba(255,255,255,0.03)',
              borderTop: '1px solid rgba(255,255,255,0.07)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Download */}
            {event?.allowDownloads !== false && (
              <button
                onClick={() => handleDownload(activePhotosList[activePhotoIndex].r2Url, activePhotosList[activePhotoIndex].filename)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.55rem',
                  padding: '0 2.25rem', height: '100%',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'rgba(255,255,255,0.45)',
                  fontFamily: "'Montserrat', system-ui, sans-serif",
                  fontSize: '0.5rem', letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 600,
                  transition: 'color 0.2s',
                }}
                onMouseOver={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.9)')}
                onMouseOut={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
                </svg>
                Download
              </button>
            )}

            {/* Divider */}
            <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

            {/* Counter */}
            <span style={{
              padding: '0 2.25rem',
              color: 'rgba(255,255,255,0.2)',
              fontFamily: "'Montserrat', system-ui, sans-serif",
              fontSize: '0.5rem', letterSpacing: '0.28em', textTransform: 'uppercase', fontWeight: 500,
              whiteSpace: 'nowrap',
            }}>
              {activePhotoIndex + 1}&nbsp;/&nbsp;{activePhotosList.length}
            </span>

            {/* Divider */}
            <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

            {/* Like */}
            <button
              onClick={() => toggleLikeOnPhoto(activePhotosList[activePhotoIndex].id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.55rem',
                padding: '0 2.25rem', height: '100%',
                background: 'none', border: 'none', cursor: 'pointer',
                color: activePhotosList[activePhotoIndex].isLiked ? '#ff6b81' : 'rgba(255,255,255,0.45)',
                fontFamily: "'Montserrat', system-ui, sans-serif",
                fontSize: '0.5rem', letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 600,
                transition: 'color 0.2s',
              }}
              onMouseOver={e => { if (!activePhotosList[activePhotoIndex].isLiked) e.currentTarget.style.color = 'rgba(255,255,255,0.9)' }}
              onMouseOut={e => { if (!activePhotosList[activePhotoIndex].isLiked) e.currentTarget.style.color = 'rgba(255,255,255,0.45)' }}
            >
              <svg
                width="13" height="13"
                viewBox="0 0 24 24"
                fill={activePhotosList[activePhotoIndex].isLiked ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth={activePhotosList[activePhotoIndex].isLiked ? '0' : '1.8'}
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
              {activePhotosList[activePhotoIndex].isLiked ? 'Liked' : 'Like'}
              {(activePhotosList[activePhotoIndex].likeCount ?? 0) > 0 && (
                <span style={{ opacity: 0.6 }}>({activePhotosList[activePhotoIndex].likeCount})</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── My Profile Modal (Linen Aesthetic) ── */}
      {showProfileModal && guest && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(28, 26, 24, 0.4)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 350,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            border: '1px solid #ddd8d0',
            borderRadius: '2px',
            width: '100%',
            maxWidth: '480px',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1.5rem 2rem',
              borderBottom: '1px solid #f0ede8'
            }}>
              <h2 style={{
                fontFamily: 'Montserrat, sans-serif',
                fontSize: '0.875rem',
                fontWeight: 600,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                margin: 0,
                color: '#1c1a18'
              }}>
                Edit Profile
              </h2>
              <button 
                onClick={() => setShowProfileModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  color: '#8c867e',
                  lineHeight: 1,
                  padding: 0
                }}
              >
                &times;
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveProfile} style={{ padding: '2rem' }}>
              {updateError && (
                <div style={{
                  background: '#fff5f5',
                  border: '1px solid #feb2b2',
                  color: '#c53030',
                  padding: '0.75rem 1rem',
                  borderRadius: '2px',
                  fontSize: '0.75rem',
                  marginBottom: '1.5rem',
                  fontFamily: 'Montserrat, sans-serif'
                }}>
                  {updateError}
                </div>
              )}

              {/* Selfie Avatar Section */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                marginBottom: '2rem'
              }}>
                <div style={{
                  width: '90px',
                  height: '90px',
                  borderRadius: '50%',
                  overflow: 'hidden',
                  background: '#f8f7f3',
                  border: '1px solid #ddd8d0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  marginBottom: '1rem'
                }}>
                  {newSelfiePreview || selfiePreview ? (
                    <img 
                      src={newSelfiePreview || selfiePreview || ''} 
                      alt="Selfie Preview" 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: '2rem', color: '#ddd8d0' }}>👤</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowCameraCaptureModal(true)}
                  style={{
                    background: 'none',
                    border: '1px solid #ddd8d0',
                    color: '#1c1a18',
                    padding: '0.4rem 1rem',
                    fontSize: '0.6875rem',
                    fontWeight: 500,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    borderRadius: '2px',
                    fontFamily: 'Montserrat, sans-serif'
                  }}
                >
                  Change Selfie
                </button>
                <p style={{
                  fontSize: '0.625rem',
                  color: '#8c867e',
                  marginTop: '0.5rem',
                  textAlign: 'center',
                  fontFamily: 'Montserrat, sans-serif'
                }}>
                  Take a clear close-up selfie using your camera to find your wedding photos automatically.
                </p>
              </div>

              {/* Fields */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.625rem',
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#8c867e',
                  marginBottom: '0.5rem',
                  fontFamily: 'Montserrat, sans-serif'
                }}>
                  Email Address
                </label>
                <div style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  border: '1px solid #ddd8d0',
                  borderRadius: '2px',
                  fontSize: '0.8125rem',
                  fontFamily: 'Montserrat, sans-serif',
                  color: '#8c867e',
                  background: '#f8f7f3',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxSizing: 'border-box'
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b5b0aa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  {guest.email}
                </div>
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.625rem',
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#8c867e',
                  marginBottom: '0.5rem',
                  fontFamily: 'Montserrat, sans-serif'
                }}>
                  Full Name
                </label>
                <input 
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    border: '1px solid #ddd8d0',
                    borderRadius: '2px',
                    fontSize: '0.8125rem',
                    fontFamily: 'Montserrat, sans-serif',
                    color: '#1c1a18',
                    background: '#ffffff'
                  }}
                />
              </div>

              <div style={{ marginBottom: '2.5rem' }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.625rem',
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#8c867e',
                  marginBottom: '0.5rem',
                  fontFamily: 'Montserrat, sans-serif'
                }}>
                  Phone Number
                </label>
                <input 
                  type="text"
                  value={editPhone}
                  onChange={(e) => {
                    setEditPhone(e.target.value)
                    if (phoneValidationError) setPhoneValidationError(null)
                  }}
                  placeholder="e.g. +91 98765 43210"
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    border: phoneValidationError ? '1px solid #ff4d4d' : '1px solid #ddd8d0',
                    borderRadius: '2px',
                    fontSize: '0.8125rem',
                    fontFamily: 'Montserrat, sans-serif',
                    color: '#1c1a18',
                    background: '#ffffff',
                    outline: 'none',
                    animation: shakePhone ? 'shake 0.4s ease-in-out' : 'none'
                  }}
                />
                {phoneValidationError && (
                  <div style={{
                    fontFamily: 'Montserrat, sans-serif',
                    fontSize: '0.7rem',
                    color: '#ff4d4d',
                    marginTop: '0.5rem',
                    textAlign: 'left'
                  }}>
                    {phoneValidationError}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  style={{
                    flex: 1,
                    background: 'none',
                    border: '1px solid #ddd8d0',
                    color: '#8c867e',
                    padding: '0.85rem 1.5rem',
                    fontSize: '0.6875rem',
                    fontWeight: 500,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    borderRadius: '2px',
                    fontFamily: 'Montserrat, sans-serif'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingProfile}
                  style={{
                    flex: 1,
                    background: '#1c1a18',
                    border: '1px solid #1c1a18',
                    color: '#ffffff',
                    padding: '0.85rem 1.5rem',
                    fontSize: '0.6875rem',
                    fontWeight: 500,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    borderRadius: '2px',
                    fontFamily: 'Montserrat, sans-serif'
                  }}
                >
                  {updatingProfile ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CameraCaptureModal
        isOpen={showCameraCaptureModal}
        onClose={() => {
          setShowCameraCaptureModal(false)
          setValidationStatus('idle')
          setSelfieError('')
        }}
        onCapture={handleCameraCapture}
        status={validationStatus}
        feedbackMessage={selfieError}
        onContinue={() => {
          setShowCameraCaptureModal(false)
          setValidationStatus('idle')
          setSelfieError('')
        }}
        onRetake={() => {
          setValidationStatus('idle')
          setSelfieError('')
        }}
      />
      <style jsx global>{`
        @keyframes scan {
          0% { top: 0%; opacity: 0.8; }
          50% { top: 100%; opacity: 0.8; }
          100% { top: 0%; opacity: 0.8; }
        }
        .cover-cta:hover {
          background: #fff !important;
          border-color: #fff !important;
          color: #000 !important;
        }
        .scroll-chevron {
          animation: bounce 2.2s ease-in-out infinite;
        }
        @keyframes bounce {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50% { transform: translateX(-50%) translateY(5px); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        @media (max-width: 640px) {
          .story-masonry { gap: 6px !important; padding: 8px 12px 24px !important; }
          .story-masonry > div { gap: 6px !important; }
        }
        @media (max-width: 900px) {
          .footer-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 500px) {
          .footer-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}
