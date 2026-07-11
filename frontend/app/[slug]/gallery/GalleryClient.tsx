'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { CameraCaptureModal } from '@/components/CameraCaptureModal'

export default function GuestGallerySplash({ slug }: { slug: string }) {
  const router = useRouter()
  
  const [event, setEvent] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [guest, setGuest] = useState<any>(null)
  
  const [showPhoneModal, setShowPhoneModal] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [submittingPhone, setSubmittingPhone] = useState(false)
  const [phoneError, setPhoneError] = useState('')
  const [shakeInput, setShakeInput] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)


  const [showSelfieCapture, setShowSelfieCapture] = useState(false)
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
  const [submittingSelfie, setSubmittingSelfie] = useState(false)
  const [selfieError, setSelfieError] = useState('')
  const [validationStatus, setValidationStatus] = useState<'idle' | 'verifying' | 'accepted' | 'rejected'>('idle')

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const code = searchParams.get('code')

    // 1. Fetch public event details
    fetch(`${apiUrl}/api/gallery/public/events/${slug}`)
      .then(res => {
        if (!res.ok) throw new Error('Gallery not found or inactive')
        return res.json()
      })
      .then(async data => {
        setEvent(data)

        // 2. Check if already authenticated
        let token = localStorage.getItem(`mv_gallery_token_${slug}`)
        let savedGuest = localStorage.getItem(`mv_gallery_guest_${slug}`)

        // Universal guest login: If not logged in here but logged in globally in Circle, perform SSO exchange
        if (!token && localStorage.getItem('mv_circle_token')) {
          const circleToken = localStorage.getItem('mv_circle_token')
          try {
            const ssoRes = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/auth-from-family`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${circleToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ code: code || undefined })
            })
            if (ssoRes.ok) {
              const ssoData = await ssoRes.json()
              localStorage.setItem(`mv_gallery_token_${slug}`, ssoData.token)
              localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(ssoData.guest))
              token = ssoData.token
              savedGuest = JSON.stringify(ssoData.guest)
            }
          } catch (ssoErr) {
            console.error('Seamless Circle SSO exchange failed:', ssoErr)
          }
        }

        if (token && savedGuest) {
          let parsedGuest = JSON.parse(savedGuest)
          // If code is present and guest doesn't have full access yet, auto-upgrade
          if (code && !parsedGuest.hasFullAccess) {
            try {
              const upgRes = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/upgrade`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ code })
              })
              if (upgRes.ok) {
                const upgData = await upgRes.json()
                localStorage.setItem(`mv_gallery_token_${slug}`, upgData.token)
                localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(upgData.guest))
                parsedGuest = upgData.guest
              }
            } catch (upgErr) {
              console.error('Auto-upgrade failed:', upgErr)
            }
          }

          setGuest(parsedGuest)
          if (!parsedGuest.phoneNumber) {
            setLoading(false)
            setShowPhoneModal(true)
          } else if (!parsedGuest.hasSelfie) {
            setLoading(false)
            setShowSelfieCapture(true)
          } else {
            await syncProfileAndRedirect(parsedGuest)
            setLoading(false)
            router.push(`/${slug}/gallery/photos`)
          }
        } else {
          setLoading(false)
        }
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [slug, router, apiUrl])



  // Initialize Google Identity Services on page load/event load
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).google && event) {
      initializeGoogle()
    }
  }, [event])

  const initializeGoogle = () => {
    const google = (window as any).google
    const btnContainer = document.getElementById('google-signin-btn')
    if (!google || !event || !btnContainer) return

    google.accounts.id.initialize({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '1047124976775-mock.apps.googleusercontent.com',
      callback: handleGoogleCredentialResponse
    })

    google.accounts.id.renderButton(
      btnContainer,
      { theme: 'filled_black', size: 'large', width: '280', shape: 'rectangular' }
    )
  }

  const handleGoogleCredentialResponse = async (response: any) => {
    try {
      setLoading(true)
      const searchParams = new URLSearchParams(window.location.search)
      const code = searchParams.get('code')

      const res = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          token: response.credential,
          code
        })
      })

      if (!res.ok) throw new Error('Google authentication failed')
      const data = await res.json()

      completeLogin(data)
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }
  const handleLogout = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }
    // Clear ALL gallery and circle tokens — not just current slug
    // (prevents Circle from auto-re-login via any leftover gallery token)
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
    setGuest(null)
    setShowPhoneModal(false)
    setShowSelfieCapture(false)
    setShowLoginModal(false)
    setLoading(false)
    setPhoneNumber('')
    setPhoneError('')
    setSelfiePreview(null)
    setSelfieError('')
    setValidationStatus('idle')
  }


  const syncProfileAndRedirect = async (fallbackGuest: any) => {
    setLoading(true)
    const token = localStorage.getItem(`mv_gallery_token_${slug}`)
    try {
      const profileRes = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (profileRes.ok) {
        const profileData = await profileRes.json()
        if (profileData && profileData.profile) {
          const updatedGuest = {
            ...fallbackGuest,
            name: profileData.profile.name,
            phoneNumber: profileData.profile.phoneNumber,
            hasSelfie: profileData.profile.hasSelfie,
            hasFullAccess: profileData.profile.hasFullAccess
          }
          localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(updatedGuest))
          setGuest(updatedGuest)
          return
        }
      }
    } catch (syncErr) {
      console.error('Failed to sync guest profile on redirect:', syncErr)
    }
    
    // Fallback: use local fallback guest if sync failed or API is offline
    localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(fallbackGuest))
    setGuest(fallbackGuest)
  }

  const completeLogin = async (data: any) => {
    localStorage.setItem(`mv_gallery_token_${slug}`, data.token)
    localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(data.guest))
    setGuest(data.guest)
    setShowLoginModal(false)

    // If guest doesn't have a phone number, show the prompt modal
    if (!data.guest.phoneNumber) {
      setLoading(false)
      setShowPhoneModal(true)
    } else if (!data.guest.hasSelfie) {
      setLoading(false)
      setShowSelfieCapture(true)
    } else {
      await syncProfileAndRedirect(data.guest)
      setLoading(false)
      router.push(`/${slug}/gallery/photos`)
    }
  }

  const triggerPhoneError = (msg: string) => {
    setPhoneError(msg)
    setShakeInput(true)
    setTimeout(() => setShakeInput(false), 400)
  }

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPhoneError('')
    if (!phoneNumber) return
    
    const cleanNum = phoneNumber.replace(/[\s\-\(\)\+]/g, '')
    const looksLikeIndian = cleanNum.length === 10 || (cleanNum.length === 11 && cleanNum.startsWith('0')) || (cleanNum.length === 12 && cleanNum.startsWith('91'))
    
    let isValid = false
    if (looksLikeIndian) {
      isValid = /^(?:91|0)?[6-9]\d{9}$/.test(cleanNum)
    } else {
      isValid = /^[1-9]\d{9,14}$/.test(cleanNum)
    }

    if (!isValid) {
      if (cleanNum.length === 10 && !/^[6-9]/.test(cleanNum)) {
        triggerPhoneError('Invalid Indian number (must start with 6-9). For international numbers, add the country code (e.g. +1...)')
      } else {
        triggerPhoneError('Please enter a valid mobile number (including country code)')
      }
      return
    }

    setSubmittingPhone(true)

    const token = localStorage.getItem(`mv_gallery_token_${slug}`)
    try {
      const res = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/phone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ phoneNumber })
      })

      if (!res.ok) throw new Error('Failed to save phone number')
      
      // Update local storage guest info
      const updatedGuest = { ...guest, phoneNumber }
      localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(updatedGuest))
      setGuest(updatedGuest)

      setShowPhoneModal(false)
      
      if (!updatedGuest.hasSelfie) {
        setShowSelfieCapture(true)
      } else {
        await syncProfileAndRedirect(updatedGuest)
        setLoading(false)
        router.push(`/${slug}/gallery/photos`)
      }
    } catch (err: any) {
      triggerPhoneError(err.message || 'Failed to save phone number')
    } finally {
      setSubmittingPhone(false)
    }
  }

  const handleCameraCapture = (dataUrl: string) => {
    setSelfiePreview(dataUrl)
    verifySelfie(dataUrl)
  }

  const verifySelfie = async (dataUrl: string) => {
    setValidationStatus('verifying')
    setSelfieError('')
    const token = localStorage.getItem(`mv_gallery_token_${slug}`)
    try {
      const fetchRes = await fetch(dataUrl)
      const blob = await fetchRes.blob()
      const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' })

      const formData = new FormData()
      formData.append('selfie', file)

      const res = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/selfie`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify selfie.')
      }

      setValidationStatus('accepted')
    } catch (err: any) {
      setValidationStatus('rejected')
      setSelfieError(err.message || 'Verification failed. Please retake the photo.')
    }
  }

  const handleContinueToGallery = async () => {
    if (validationStatus !== 'accepted') return
    
    // Update local storage guest info
    const updatedGuest = { ...guest, hasSelfie: true }
    await syncProfileAndRedirect(updatedGuest)
    setLoading(false)

    // Close modals and redirect
    setShowSelfieCapture(false)
    router.push(`/${slug}/gallery/photos`)
  }

  const handleRetake = () => {
    setSelfiePreview(null)
    setSelfieError('')
    setValidationStatus('idle')
    startCamera()
  }

  if (loading && !showPhoneModal && !showSelfieCapture) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#f5f4f0]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#0f172a] border-t-transparent"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-[#f5f4f0] px-4 text-center">
        <h1 className="font-lora text-2xl font-semibold text-red-600 mb-2">Error Loading Gallery</h1>
        <p className="font-sans text-neutral-600 mb-4">{error}</p>
        <button 
          onClick={() => window.location.reload()} 
          className="rounded-full bg-[#0f172a] px-6 py-2 text-white font-sans text-sm hover:opacity-90"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div 
      className="force-light"
      style={{
        colorScheme: 'light',
        position: 'relative',
        width: '100%',
        height: '100svh',
        minHeight: '560px',
        overflow: 'hidden',
        background: '#111',
        cursor: (showLoginModal || showPhoneModal || showSelfieCapture) ? 'default' : 'pointer'
      }}
      onClick={() => {
        if (!showLoginModal && !showPhoneModal && !showSelfieCapture) {
          setShowLoginModal(true)
        }
      }}
    >
      <Script 
        src="https://accounts.google.com/gsi/client" 
        onLoad={initializeGoogle}
        strategy="afterInteractive"
      />

      {/* Full-bleed Cover Image */}
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
        zIndex: 10
      }} />

      {/* Central Event Information & ENTER CTA */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '0 2rem',
        justifyContent: 'center',
        zIndex: 20
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
            marginBottom: '3rem',
          }}>
            {new Date(event.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}

        <button 
          onClick={(e) => { e.stopPropagation(); setShowLoginModal(true); }}
          className="cover-cta"
        >
          Enter Gallery
        </button>
      </div>

      {/* Brand Footer Logo */}
      {!showLoginModal && (
        <div style={{
          position: 'absolute',
          bottom: '2rem',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          zIndex: 20
        }}>
          <a 
            href="https://mistyvisuals.com" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ cursor: 'pointer', display: 'block', transition: 'opacity 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src="/logo-white.png" 
              alt="Misty Visuals Logo" 
              style={{ height: '4rem', width: 'auto', objectFit: 'contain' }} 
            />
          </a>
        </div>
      )}

      {/* Glassmorphic Login Overlay Modal */}
      <div 
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.25)',
          zIndex: 50,
          padding: '0 2rem',
          opacity: showLoginModal ? 1 : 0,
          visibility: showLoginModal ? 'visible' : 'hidden',
          pointerEvents: showLoginModal ? 'auto' : 'none',
          transition: 'opacity 0.3s ease, visibility 0.3s ease'
        }}
        onClick={(e) => { e.stopPropagation(); setShowLoginModal(false); }}
      >
        <div 
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: '380px',
            backgroundColor: 'rgba(15, 15, 15, 0.55)',
            backdropFilter: 'blur(30px)',
            borderRadius: '0px',
            padding: '3.5rem 2.5rem 2.5rem',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 40px 80px rgba(0, 0, 0, 0.45)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transform: showLoginModal ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(12px)',
            opacity: showLoginModal ? 1 : 0,
            transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
            {/* Brand Logo inside Modal */}
            <img 
              src="/logo-white.png" 
              alt="Misty Visuals Logo" 
              style={{ height: '3.5rem', width: 'auto', objectFit: 'contain', marginBottom: '1.75rem' }} 
            />

            <h2 style={{
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '1rem',
              fontWeight: 500,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              textAlign: 'center',
              marginBottom: '0.75rem',
              color: '#ffffff'
            }}>
              Welcome Guests
            </h2>
            <p style={{
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '0.7rem',
              fontWeight: 400,
              letterSpacing: '0.02em',
              color: '#a3a3a3',
              textAlign: 'center',
              lineHeight: 1.6,
              marginBottom: '2.5rem'
            }}>
              Log in with your social account to instantly find your photos using AI face recognition.
            </p>

            {/* OAuth Buttons Container */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', alignItems: 'center' }}>
              <div id="google-signin-btn" style={{ width: '280px', display: 'flex', justifyContent: 'center', minHeight: '44px' }} />

              <button 
                onClick={() => alert('Apple Sign-In is coming soon. Please use Google Sign-In to log in.')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.75rem',
                  width: '280px',
                  height: '40px',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  borderRadius: '0px',
                  padding: '0 1rem',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  color: '#ffffff',
                  fontFamily: '"Montserrat", system-ui, sans-serif',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#ffffff';
                  e.currentTarget.style.color = '#000000';
                  e.currentTarget.style.borderColor = '#ffffff';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                  e.currentTarget.style.color = '#ffffff';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                }}
              >
                <svg style={{ width: '1rem', height: '1rem', fill: 'currentColor' }} viewBox="0 0 24 24">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-.96.04-2.13.64-2.82 1.45-.6.7-1.13 1.84-.99 2.94.12 0 .24.01.36.01.9 0 2-.62 2.46-1.34z"/>
                </svg>
                <span>SIGN IN WITH APPLE</span>
              </button>
            </div>

            <button 
              onClick={(e) => { e.stopPropagation(); setShowLoginModal(false); }}
              style={{
                marginTop: '2rem',
                fontSize: '0.65rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'rgba(255, 255, 255, 0.4)',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'color 0.2s ease',
                fontFamily: '"Montserrat", system-ui, sans-serif',
              }}
              onMouseOver={(e) => e.currentTarget.style.color = '#ffffff'}
              onMouseOut={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)'}
            >
              Go Back
            </button>
          </div>
        </div>

      {/* Phone Number Modal */}
      {showPhoneModal && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            padding: '1rem'
          }}
        >
          <div 
            style={{
              width: '100%',
              maxWidth: '400px',
              backgroundColor: 'rgba(15, 15, 15, 0.55)',
              backdropFilter: 'blur(30px)',
              borderRadius: '0px',
              padding: '3rem 2.5rem 2.5rem',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '0 40px 80px rgba(0, 0, 0, 0.45)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              animation: 'modalFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <h3 style={{
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '1rem',
              fontWeight: 500,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              textAlign: 'center',
              marginBottom: '0.75rem',
              color: '#ffffff'
            }}>
              Enter your number
            </h3>
            <p style={{
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '0.7rem',
              fontWeight: 400,
              letterSpacing: '0.02em',
              color: '#a3a3a3',
              textAlign: 'center',
              lineHeight: 1.6,
              marginBottom: '2rem'
            }}>
              Enter your phone number so we can notify you if additional photos are uploaded to the gallery.
            </p>

            <form onSubmit={handlePhoneSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <input
                type="tel"
                placeholder="Phone Number (e.g. +91 99999 99999)"
                value={phoneNumber}
                onChange={e => {
                  setPhoneNumber(e.target.value)
                  if (phoneError) setPhoneError('')
                }}
                style={{
                  width: '100%',
                  padding: '0.9rem 1rem',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  border: phoneError ? '1px solid #ff4d4d' : '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  fontFamily: '"Montserrat", system-ui, sans-serif',
                  fontSize: '0.75rem',
                  outline: 'none',
                  borderRadius: '0px',
                  animation: shakeInput ? 'shake 0.4s ease-in-out' : 'none'
                }}
                required
              />

              {phoneError && (
                <div style={{
                  fontFamily: '"Montserrat", system-ui, sans-serif',
                  fontSize: '0.7rem',
                  color: '#ff4d4d',
                  textAlign: 'center',
                  width: '100%',
                  marginTop: '-0.5rem',
                  marginBottom: '0.25rem'
                }}>
                  {phoneError}
                </div>
              )}

              <button
                type="submit"
                disabled={submittingPhone}
                style={{
                  width: '100%',
                  padding: '0.9rem',
                  backgroundColor: '#ffffff',
                  color: '#000000',
                  border: 'none',
                  fontFamily: '"Montserrat", system-ui, sans-serif',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  opacity: submittingPhone ? 0.6 : 1,
                  transition: 'opacity 0.2s'
                }}
              >
                {submittingPhone ? 'Saving...' : 'Save & Continue'}
              </button>
            </form>

            <button
              onClick={handleLogout}
              style={{
                marginTop: '1.5rem',
                fontSize: '0.65rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'rgba(255, 255, 255, 0.4)',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'color 0.2s ease',
                fontFamily: '"Montserrat", system-ui, sans-serif',
              }}
              onMouseOver={(e) => e.currentTarget.style.color = '#ffffff'}
              onMouseOut={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)'}
            >
              GO BACK
            </button>
          </div>
        </div>
      )}



      <CameraCaptureModal
        isOpen={showSelfieCapture}
        onClose={() => {
          setShowSelfieCapture(false)
          setSelfiePreview(null)
          setValidationStatus('idle')
          setSelfieError('')
        }}
        onCapture={handleCameraCapture}
        status={validationStatus}
        feedbackMessage={selfieError}
        onContinue={handleContinueToGallery}
        onGoBackCustom={handleLogout}
        onRetake={() => {
          setValidationStatus('idle')
          setSelfieError('')
          setSelfiePreview(null)
        }}
      />

      <style>{`
        .cover-cta {
          font-family: var(--font-sans);
          font-size: 0.5625rem;
          font-weight: 500;
          color: #ffffff;
          letter-spacing: 0.25em;
          text-transform: uppercase;
          border: 1px solid #ffffff;
          border-radius: 0px;
          padding: 0.9rem 2.25rem;
          background-color: transparent;
          cursor: pointer;
          transition: background 0.3s, border-color 0.3s;
        }
        .cover-cta:hover {
          background-color: #ffffff;
          border-color: #ffffff;
          color: #000000;
        }
        #google-signin-btn {
          border-radius: 0px;
        }
        @keyframes modalFadeIn {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  )
}
