'use client'

import React, { useState, useEffect } from 'react'
import Script from 'next/script'
import { useRouter } from 'next/navigation'
import { CameraCaptureModal } from '@/components/CameraCaptureModal'
import { GuestLoginFlow } from '@/components/GuestLoginFlow'
import { UserAvatarDropdown } from '@/components/UserAvatarDropdown'


const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface CircleEvent {
  id: number
  title: string
  slug: string
  date: string
  coverPhotoUrl: string | null
  coverPhotoMobileUrl: string | null
  coverPhotoSquareUrl: string | null
  matchedCount: number
  eventToken: string
  guestInfo: {
    id: number
    name: string
    email: string
    phoneNumber: string | null
    hasFullAccess: boolean
  }
}

export default function CirclePage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [profile, setProfile] = useState<any>(null)
  const [events, setEvents] = useState<CircleEvent[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null)
  const [showLoginModal, setShowLoginModal] = useState(false)

  // Helper to fetch selfie image with auth and return a blob URL
  const fetchAuthenticatedSelfie = async (selfieGuestId: number, authToken?: string) => {
    const tkn = authToken || localStorage.getItem('mv_circle_token')
    if (!tkn) return
    try {
      const res = await fetch(`${apiUrl}/api/gallery/family/selfie/${selfieGuestId}?t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${tkn}` }
      })
      if (res.ok) {
        const blob = await res.blob()
        setSelfieUrl(prev => {
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

  // Cleanup selfieUrl Blob URL on unmount
  useEffect(() => {
    return () => {
      if (selfieUrl && selfieUrl.startsWith('blob:')) {
        URL.revokeObjectURL(selfieUrl)
      }
    }
  }, [selfieUrl])

  // Profile management states
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
    if (showProfileModal) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
      setValidationStatus('idle')
      setSelfieError('')
      setShowCameraCaptureModal(false)
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [showProfileModal])

  useEffect(() => {
    // Check if circle token exists in localStorage
    const savedToken = localStorage.getItem('mv_circle_token')
    const savedProfile = localStorage.getItem('mv_circle_profile')
    if (savedToken && savedProfile) {
      setToken(savedToken)
      setProfile(JSON.parse(savedProfile))
      fetchEvents(savedToken)
      return
    }

    // Try to auto-login using an existing event guest session
    const eventToken = findExistingEventToken()
    if (eventToken) {
      autoLoginFromEventToken(eventToken)
    } else {
      setLoading(false)
    }
  }, [])

  // Lock body scroll when profile modal is open
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

  const findExistingEventToken = (): string | null => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('mv_gallery_token_')) {
        return localStorage.getItem(key)
      }
    }
    return null
  }

  const autoLoginFromEventToken = async (eventToken: string) => {
    try {
      setLoading(true)
      const res = await fetch(`${apiUrl}/api/gallery/family/auth-from-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventToken })
      })
      if (!res.ok) {
        setLoading(false)
        return
      }
      const data = await res.json()
      localStorage.setItem('mv_circle_token', data.token)
      localStorage.setItem('mv_circle_profile', JSON.stringify(data.profile))
      setToken(data.token)
      setProfile(data.profile)
      fetchEvents(data.token)
    } catch (err) {
      setLoading(false)
    }
  }



  const fetchEvents = async (authToken: string) => {
    try {
      setLoading(true)
      const res = await fetch(`${apiUrl}/api/gallery/family/events`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          handleLogout()
          throw new Error('Session expired. Please log in again.')
        }
        throw new Error('Failed to load your weddings')
      }
      const data = await res.json()
      setEvents(data.events || [])
      if (data.selfieUrl) {
        // Extract guestId from selfie URL path like /api/gallery/family/selfie/123
        const selfieGuestIdMatch = data.selfieUrl.match(/selfie\/(\d+)/)
        if (selfieGuestIdMatch) {
          fetchAuthenticatedSelfie(parseInt(selfieGuestIdMatch[1]), authToken)
        }
      }
      if (data.profile) {
        localStorage.setItem('mv_circle_profile', JSON.stringify(data.profile))
        setProfile(data.profile)
      }
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLoginSuccess = (profile: any, token: string) => {
    localStorage.setItem('mv_circle_token', token)
    localStorage.setItem('mv_circle_profile', JSON.stringify(profile))
    setToken(token)
    setProfile(profile)
    setShowLoginModal(false)
    fetchEvents(token)
    if (profile.selfieGuestId) {
      fetchAuthenticatedSelfie(profile.selfieGuestId, token)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('mv_circle_token')
    localStorage.removeItem('mv_circle_profile')
    // Clear all per-slug gallery sessions
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('mv_gallery_token_') || key?.startsWith('mv_gallery_guest_')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k))
    setToken(null)
    setProfile(null)
    setEvents([])
    setSelfieUrl(null)
    setError(null)
    setShowProfileModal(false)
  }

  const openProfile = () => {
    if (!profile) return
    setEditName(profile.name || '')
    setEditPhone(profile.phoneNumber || '')
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

  const handleSaveProfile = async (e?: React.FormEvent, overrideSelfieFile?: File | null): Promise<boolean> => {
    if (e) e.preventDefault()
    if (!token) return false

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
        return false
      }
    }

    try {
      const formData = new FormData()
      formData.append('name', editName)
      formData.append('phoneNumber', editPhone)
      
      const fileToUpload = overrideSelfieFile !== undefined ? overrideSelfieFile : newSelfieFile
      if (fileToUpload) {
        formData.append('selfie', fileToUpload)
      }

      const res = await fetch(`${apiUrl}/api/gallery/family/profile/update`, {
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
      // Save updated profile to localStorage
      localStorage.setItem('mv_circle_profile', JSON.stringify(data.profile))
      setProfile(data.profile)
      setNewSelfieFile(null)
      
      // Update local states
      if (data.profile.selfieGuestId) {
        fetchAuthenticatedSelfie(data.profile.selfieGuestId)
      }

      setShowProfileModal(false)
      // Refresh events to show any newly matched weddings due to selfie change!
      fetchEvents(token)
      return true
    } catch (err: any) {
      setUpdateError(err.message)
      return false
    } finally {
      setUpdatingProfile(false)
    }
  }

  const handleEnterEventGallery = (ev: CircleEvent) => {
    localStorage.setItem(`mv_gallery_token_${ev.slug}`, ev.eventToken)
    localStorage.setItem(`mv_gallery_guest_${ev.slug}`, JSON.stringify(ev.guestInfo))
    router.push(`/${ev.slug}/gallery/photos`)
  }

  const formatEventDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    } catch (e) {
      return dateStr
    }
  }

  return (
    <div 
      className="force-light"
      style={{
        minHeight: '100vh',
        background: '#ffffff', // Clean white linen background
        color: '#1c1a18', // Warm near-black ink
        fontFamily: 'Montserrat, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '0 0 5rem 0',
        colorScheme: 'light'
      }}
    >
      {/* Load Cormorant Garamond Font */}
      <link 
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap" 
        rel="stylesheet" 
      />



      {/* ── Global Header Navbar ── */}
      <header style={{
        width: '100%',
        maxWidth: '1200px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '2.5rem 2rem 1.5rem 2rem',
        borderBottom: '1px solid #ddd8d0', // Subtle divider
        zIndex: 10
      }}>
        <a href="https://www.mistyvisuals.com" target="_blank" rel="noopener noreferrer" style={{ display: 'block', width: '112px' }}>
          <img 
            src="/logo_black.png" 
            alt="Misty Visuals" 
            style={{ width: '100%', display: 'block', opacity: 1 }} 
          />
        </a>

        {token && profile && (
          <UserAvatarDropdown
            selfieUrl={selfieUrl}
            onProfileClick={openProfile}
            onLogoutClick={handleLogout}
            darkTheme={false}
          />
        )}
      </header>

      {/* ── Cinematic Hero Title Section ── */}
      <div style={{
        width: '100%',
        textAlign: 'center',
        padding: '5rem 1.5rem 3rem 1.5rem',
        borderBottom: token ? '1px solid #f5f5f5' : 'none'
      }}>
        <p style={{
          fontSize: '0.6875rem',
          fontWeight: 400,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: '#8c867e',
          marginBottom: '1rem'
        }}>
          Memories by Misty Visuals
        </p>
        <h1 style={{
          fontSize: 'clamp(2rem, 4vw, 3.5rem)',
          fontWeight: 300,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: '1rem',
          lineHeight: 1.1,
          color: '#1c1a18'
        }}>
          MY CIRCLE
        </h1>
        <p style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 'clamp(1rem, 1.3vw, 1.2rem)',
          fontWeight: 300,
          fontStyle: 'italic',
          color: '#4a4540',
          maxWidth: '600px',
          margin: '0 auto',
          lineHeight: 1.6
        }}>
          {token && profile 
            ? `Welcome back, ${profile.name || 'Friend'}. View all your wedding celebrations and discover matched photos.`
            : 'Access all your wedding memories and matched guest photos gathered in one elegant private place.'
          }
        </p>
      </div>

      {/* ── Main Content Container ── */}
      <main style={{
        width: '100%',
        maxWidth: '1200px',
        padding: '2rem',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}>
        {loading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '5rem 0'
          }}>
            <div className="spinner" style={{
              width: '32px',
              height: '32px',
              border: '2px solid #ddd8d0',
              borderTop: '2px solid #1c1a18',
              borderRadius: '50%',
              animation: 'spin 1.2s linear infinite',
              marginBottom: '1.25rem'
            }}></div>
            <p style={{ color: '#8c867e', fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Loading memories...
            </p>
            <style jsx>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        ) : !token ? (
          /* Elegant, minimalist Unlock CTA matching the wedding gallery */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '2rem' }}>
            <button 
              onClick={() => setShowLoginModal(true)}
              style={{
                fontFamily: 'Montserrat, system-ui, sans-serif',
                fontSize: '0.75rem',
                fontWeight: 500,
                color: '#1c1a18',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                border: '1px solid #1c1a18',
                borderRadius: '0px',
                padding: '1rem 2.5rem',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                transition: 'all 0.3s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#1c1a18'
                e.currentTarget.style.color = '#ffffff'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = '#1c1a18'
              }}
            >
              Unlock My Circle
            </button>
          </div>
        ) : (
          /* Logged In Dashboard styling */
          <div style={{ width: '100%' }}>
            {error && (
              <div style={{
                background: '#fff5f5',
                border: '1px solid #feb2b2',
                color: '#c53030',
                padding: '0.75rem 1rem',
                borderRadius: '2px',
                fontSize: '0.75rem',
                marginBottom: '2rem'
              }}>
                {error}
              </div>
            )}

            {/* Weddings Grid - 3 Column Layout (Pixieset Style) */}
            {events.length === 0 ? (
              /* Empty State */
              <div style={{
                textAlign: 'center',
                padding: '5rem 2rem',
                background: '#fdfdfb',
                border: '1px dashed #ddd8d0',
                borderRadius: '2px',
                maxWidth: '600px',
                margin: '2rem auto 0 auto'
              }}>
                <h3 style={{ 
                  fontFamily: 'Montserrat, sans-serif', 
                  fontSize: '0.875rem', 
                  fontWeight: 600, 
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  marginBottom: '0.75rem', 
                  color: '#1c1a18' 
                }}>
                  No weddings unlocked yet
                </h3>
                <p style={{ color: '#8c867e', fontSize: '0.8125rem', lineHeight: 1.6, margin: 0 }}>
                  You haven't logged into any wedding galleries. Use a direct wedding link shared by the couple to register your profile first, and it will automatically be gathered here.
                </p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '3rem 2rem',
                width: '100%',
                marginTop: '1.5rem'
              }} className="stories-grid">
                {events.map((ev) => (
                  <div 
                    key={ev.id}
                    onClick={() => handleEnterEventGallery(ev)}
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'all 0.3s'
                    }}
                    className="story-card"
                  >
                    {/* Cover - 3:2 landscape ratio, clean border, NO overlay */}
                    <div style={{ 
                      aspectRatio: '3/2', 
                      overflow: 'hidden', 
                      background: '#f5f5f5', 
                      position: 'relative',
                      border: '1px solid #f0ede8'
                    }} className="cover-container">
                      {ev.coverPhotoSquareUrl || ev.coverPhotoUrl ? (
                        <img 
                          src={ev.coverPhotoSquareUrl || ev.coverPhotoUrl || ''} 
                          alt={ev.title}
                          style={{ 
                            width: '100%', 
                            height: '100%', 
                            objectFit: 'cover',
                            transition: 'transform 0.4s ease-out'
                          }} 
                          className="cover-img"
                        />
                      ) : (
                        <div style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ddd8d0',
                          fontSize: '2rem'
                        }}>
                          📷
                        </div>
                      )}

                      {/* Subtle Matched Count badge on hover or top right */}
                      {ev.matchedCount > 0 && (
                        <div style={{
                          position: 'absolute',
                          bottom: '0.75rem',
                          right: '0.75rem',
                          background: 'rgba(28, 26, 24, 0.85)',
                          backdropFilter: 'blur(4px)',
                          color: '#ffffff',
                          fontWeight: 500,
                          fontSize: '0.625rem',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          padding: '0.35rem 0.65rem',
                          borderRadius: '1px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}>
                          <span>✨</span>
                          <span>{ev.matchedCount} Photo{ev.matchedCount > 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </div>

                    {/* Caption below image - Centered, editorial style */}
                    <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
                      <h3 style={{
                        fontFamily: 'Montserrat, sans-serif',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: '#1c1a18',
                        margin: '0 0 0.4rem 0'
                      }}>
                        {ev.title}
                      </h3>
                      <p style={{ 
                        fontFamily: 'Montserrat, sans-serif',
                        fontSize: '0.625rem', 
                        fontWeight: 400,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: '#8c867e',
                        margin: 0
                      }}>
                        {formatEventDate(ev.date)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      

      {/* ── My Profile Modal (Linen Aesthetic) ── */}
      {showProfileModal && profile && (
        <div 
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(28, 26, 24, 0.4)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
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
                  marginBottom: '1.5rem'
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
                  {newSelfiePreview || selfieUrl ? (
                    <img 
                      src={newSelfiePreview || selfieUrl || ''} 
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
                    borderRadius: '2px'
                  }}
                >
                  Change Selfie
                </button>
                <p style={{
                  fontSize: '0.625rem',
                  color: '#8c867e',
                  marginTop: '0.5rem',
                  textAlign: 'center'
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
                  marginBottom: '0.5rem'
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
                  {profile?.email}
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
                  marginBottom: '0.5rem'
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
                  marginBottom: '0.5rem'
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

              {updateError && (
                <div style={{
                  fontFamily: 'Montserrat, sans-serif',
                  fontSize: '0.75rem',
                  color: '#dc2626',
                  marginBottom: '1rem',
                  textAlign: 'center',
                  background: '#fef2f2',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '2px',
                  border: '1px solid #fecaca'
                }}>
                  {updateError}
                </div>
              )}

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
                    borderRadius: '2px'
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
                    borderRadius: '2px'
                  }}
                >
                  {updatingProfile ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <GuestLoginFlow
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={handleLoginSuccess}
      />

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
        onContinue={async () => {
          if (newSelfieFile) {
            const success = await handleSaveProfile(undefined, newSelfieFile)
            if (success) {
              setShowCameraCaptureModal(false)
              setValidationStatus('idle')
              setSelfieError('')
              setShowProfileModal(false)
            } else {
              setValidationStatus('rejected')
              setSelfieError(updateError || 'Failed to save selfie. Please try again.')
            }
          } else {
            setShowCameraCaptureModal(false)
            setValidationStatus('idle')
            setSelfieError('')
            setShowProfileModal(false)
          }
        }}
        onRetake={() => {
          setValidationStatus('idle')
          setSelfieError('')
        }}
      />

      {/* Styled Grid Scaling rules */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media (max-width: 900px) {
          .stories-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .footer-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 500px) {
          .stories-grid { grid-template-columns: 1fr !important; }
          .footer-grid { grid-template-columns: 1fr !important; }
        }
        
        .story-card:hover .cover-img {
          transform: scale(1.02);
        }
        


        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
      `}} />
    </div>
  )
}
