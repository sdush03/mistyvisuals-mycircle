'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { GuestLoginFlow } from '@/components/GuestLoginFlow'

export default function GuestGallerySplash({ slug }: { slug: string }) {
  const router = useRouter()
  
  const [event, setEvent] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [guest, setGuest] = useState<any>(null)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showAppPromptModal, setShowAppPromptModal] = useState(false)
  const [inviteCode, setInviteCode] = useState<string | undefined>(undefined)
  const [existingToken, setExistingToken] = useState<string | undefined>(undefined)
  const [existingProfile, setExistingProfile] = useState<any>(null)
  const [circleToken, setCircleToken] = useState<string | undefined>(undefined)
  const [isMobileDevice, setIsMobileDevice] = useState(false)
  const [devicePlatform, setDevicePlatform] = useState<'ios' | 'android' | 'other'>('other')

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''

  useEffect(() => {
    // Detect mobile platform
    const ua = typeof window !== 'undefined' ? (navigator.userAgent || navigator.vendor || (window as any).opera || '') : ''
    const isTouchMac = /Macintosh/.test(ua) && (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
    const isMobile = (/iPad|iPhone|iPod|android/i.test(ua) || isTouchMac) && !(window as any).MSStream
    if (isMobile) {
      setIsMobileDevice(true)
      if (/iPad|iPhone|iPod/.test(ua) || isTouchMac) setDevicePlatform('ios')
      else if (/android/i.test(ua)) setDevicePlatform('android')
    }

    const searchParams = new URLSearchParams(window.location.search)
    const code = searchParams.get('code')
    if (code) {
      setInviteCode(code)
    }

    const cToken = localStorage.getItem('mv_circle_token')
    if (cToken) {
      setCircleToken(cToken)
    }

    const fetchUrl = `${apiUrl}/api/gallery/public/events/${slug}`

    // 1. Fetch public event details
    fetch(fetchUrl)
      .then(res => {
        if (!res.ok) throw new Error('Gallery not found or inactive')
        return res.json()
      })
      .then(async data => {
        setEvent(data)

        // 2. Check if already authenticated
        const token = localStorage.getItem(`mv_gallery_token_${slug}`)
        if (token) {
          try {
            // Verify token is valid & fetch profiles
            const profileRes = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/profile`, {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            })
            
            if (profileRes.ok) {
              const profileData = await profileRes.json()
              if (profileData && profileData.profile) {
                const localGuest = {
                  id: profileData.profile.id,
                  name: profileData.profile.name,
                  email: profileData.profile.email,
                  phoneNumber: profileData.profile.phoneNumber,
                  hasSelfie: profileData.profile.hasSelfie,
                  hasFullAccess: profileData.profile.hasFullAccess
                }
                
                // If they are logged in as partial, but landed with a code, auto-upgrade them in background
                if (!localGuest.hasFullAccess && code) {
                  try {
                    const upgradeRes = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/upgrade`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify({ code })
                    })
                    if (upgradeRes.ok) {
                      const upgradeData = await upgradeRes.json()
                      localStorage.setItem(`mv_gallery_token_${slug}`, upgradeData.token)
                      localGuest.hasFullAccess = true
                    }
                  } catch (upgradeErr) {
                    console.error('Failed to auto-upgrade session:', upgradeErr)
                  }
                }
                
                setExistingToken(token)
                setExistingProfile(localGuest)
                
                // Only bypass if both are complete and not on mobile and downloads are allowed
                if (data.allowDownloads !== false && !isMobile && localGuest.phoneNumber && localGuest.hasSelfie) {
                  localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(localGuest))
                  setGuest(localGuest)
                  router.push(`/${slug}/gallery/photos`)
                  return
                } else if (!isMobile && data.allowDownloads !== false) {
                  // Incomplete profile: force open login modal to prompt mobile/selfie completion on desktop
                  setShowLoginModal(true)
                }
              }
            }
          } catch (syncErr) {
            console.error('Failed to sync guest session:', syncErr)
          }
        } else {
          // If no gallery token, check if they are logged in globally on My Circle
          const globalCircleToken = cToken || localStorage.getItem('mv_circle_token')
          if (globalCircleToken) {
            try {
              const exchangeRes = await fetch(`${apiUrl}/api/gallery/public/events/${slug}/auth-from-family`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${globalCircleToken}`
                },
                body: JSON.stringify({ code })
              })
              
              if (exchangeRes.ok) {
                const exchangeData = await exchangeRes.json()
                if (exchangeData && exchangeData.token) {
                  const localGuest = {
                    id: exchangeData.guest.id,
                    name: exchangeData.guest.name,
                    email: exchangeData.guest.email,
                    phoneNumber: exchangeData.guest.phoneNumber,
                    hasSelfie: exchangeData.guest.hasSelfie,
                    hasFullAccess: exchangeData.guest.hasFullAccess
                  }
                  
                  localStorage.setItem(`mv_gallery_token_${slug}`, exchangeData.token)
                  setExistingToken(exchangeData.token)
                  setExistingProfile(localGuest)
                  
                  if (data.allowDownloads !== false && !isMobile && localGuest.phoneNumber && localGuest.hasSelfie) {
                    localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(localGuest))
                    setGuest(localGuest)
                    router.push(`/${slug}/gallery/photos`)
                    return
                  } else if (!isMobile && data.allowDownloads !== false) {
                    // Incomplete profile: force open login modal to prompt mobile/selfie completion on desktop
                    setShowLoginModal(true)
                  }
                }
              } else if (exchangeRes.status === 401 || exchangeRes.status === 403) {
                // Stale / expired global Circle token - clear it so guest login falls back to social auth
                localStorage.removeItem('mv_circle_token')
                localStorage.removeItem('mv_circle_profile')
                setCircleToken(undefined)
              }
            } catch (exchangeErr) {
              console.error('Failed to auto-authenticate using Circle token:', exchangeErr)
            }
          }
        }
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [slug, router, apiUrl])

  const handleLoginSuccess = (profile: any, token: string) => {
    setLoading(true)
    localStorage.setItem(`mv_gallery_token_${slug}`, token)
    localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(profile))
    setGuest(profile)
    setShowLoginModal(false)
    router.push(`/${slug}/gallery/photos`)
  }

  const handleOpenApp = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()

    // Record deferred invite with backend (IP + Device fingerprint)
    try {
      fetch(`${apiUrl}/api/gallery/public/record-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, code: inviteCode }),
        keepalive: true
      }).catch(() => {})
    } catch (_) {}

    const deepLinkUrl = `mycircle://${slug}${inviteCode ? `?code=${encodeURIComponent(inviteCode)}` : ''}`
    const appStoreUrl = 'https://apps.apple.com/app/id6796633077'
    const playStoreReferrer = `slug%3D${encodeURIComponent(slug)}${inviteCode ? `%26code%3D${encodeURIComponent(inviteCode)}` : ''}`
    const playStoreUrl = `https://play.google.com/store/apps/details?id=com.mistyvisuals.mycircle&referrer=${playStoreReferrer}`

    if (devicePlatform === 'ios') {
      window.location.href = appStoreUrl
    } else if (devicePlatform === 'android') {
      const androidIntentUrl = `intent://${slug}${inviteCode ? `?code=${encodeURIComponent(inviteCode)}` : ''}#Intent;scheme=mycircle;package=com.mistyvisuals.mycircle;S.market_referrer=${playStoreReferrer};end;`
      window.location.href = androidIntentUrl
    } else {
      if (event?.allowDownloads === false) {
        setShowAppPromptModal(true)
      } else {
        setShowLoginModal(true)
      }
    }
  }

  const handleEnterGallery = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (isMobileDevice) {
      handleOpenApp(e)
    } else if (event?.allowDownloads === false) {
      setShowAppPromptModal(true)
    } else {
      setShowLoginModal(true)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#f5f4f0]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#0f172a] border-t-transparent"></div>
      </div>
    )
  }

  if (error) {
    const isUnpublished = error === 'Gallery not found or inactive'
    
    return (
      <div 
        className="force-light flex h-screen w-full flex-col items-center justify-center px-4 text-center select-none"
        style={{
          colorScheme: 'light',
          background: 'radial-gradient(circle at center, #fbfbfa 0%, #f4f3f0 100%)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{
          position: 'absolute',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '400px',
          height: '400px',
          borderRadius: '50%',
          background: isUnpublished 
            ? 'radial-gradient(circle, rgba(217,119,6,0.06) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 70%)',
          filter: 'blur(40px)',
          zIndex: 1,
          pointerEvents: 'none'
        }} />

        <div 
          className="relative z-10 flex max-w-[440px] w-full flex-col items-center rounded-2xl border border-[#eae8e3] bg-white p-8 md:p-10 shadow-[0_20px_50px_rgba(28,26,24,0.06)]"
        >
          <div className="mb-8">
            <a 
              href="https://mistyvisuals.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="block opacity-90 transition-opacity hover:opacity-100"
            >
              <img 
                src="/logo_black.png" 
                alt="Misty Visuals Logo" 
                style={{ height: '3rem', width: 'auto', objectFit: 'contain' }} 
              />
            </a>
          </div>

          {isUnpublished ? (
            <div className="relative mb-6 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-amber-500/5 blur-xl w-16 h-16"></div>
              <div className="relative flex items-center justify-center w-16 h-16 rounded-full border border-amber-200 bg-amber-50/80 shadow-inner">
                <svg className="w-7 h-7 text-amber-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
            </div>
          ) : (
            <div className="relative mb-6 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-blue-500/5 blur-xl w-16 h-16"></div>
              <div className="relative flex items-center justify-center w-16 h-16 rounded-full border border-blue-200 bg-blue-50/80 shadow-inner">
                <svg className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
            </div>
          )}

          <h1 className="font-lora text-2xl font-semibold text-[#1c1a18] tracking-wide mb-3">
            {isUnpublished ? 'Gallery Unpublished' : 'Connection Offline'}
          </h1>

          <p className="font-sans text-sm text-neutral-500 leading-relaxed mb-8 px-2 max-w-sm">
            {isUnpublished 
              ? 'This photo gallery is currently set to private or has not been published yet. Please check back later or contact your photographer/host for access details.' 
              : error}
          </p>

          <div className="flex w-full flex-col gap-3">
            <button 
              onClick={() => window.location.reload()} 
              className="w-full rounded-lg bg-[#1c1a18] py-3 text-white font-sans text-xs font-semibold uppercase tracking-widest shadow-md transition-all hover:bg-[#2d2a26] active:scale-[0.98] cursor-pointer"
            >
              Refresh Page
            </button>
            {isUnpublished && (
              <a 
                href="https://mistyvisuals.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-full rounded-lg border border-[#1c1a18]/15 py-3 text-[#1c1a18] font-sans text-xs font-semibold uppercase tracking-widest transition-all hover:bg-[#1c1a18]/5 active:scale-[0.98] cursor-pointer flex items-center justify-center"
                style={{ textDecoration: 'none' }}
              >
                Visit Misty Visuals
              </a>
            )}
          </div>
        </div>
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
        cursor: showLoginModal ? 'default' : 'pointer'
      }}
      onClick={() => {
        if (!showLoginModal) {
          handleEnterGallery()
        }
      }}
    >
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
          onClick={handleEnterGallery}
          className="cover-cta"
        >
          {event?.allowDownloads === false ? 'View in App' : 'Enter Gallery'}
        </button>
        {event?.allowDownloads === false && (
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '0.6875rem',
            color: 'rgba(255,255,255,0.7)',
            marginTop: '0.85rem',
            letterSpacing: '0.06em',
            textTransform: 'uppercase'
          }}>
            🔒 Protected Gallery — App Exclusive
          </p>
        )}
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

      {/* Download Blocked Desktop App Prompt Modal */}
      {showAppPromptModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
          onClick={() => setShowAppPromptModal(false)}
        >
          <div
            className="relative flex max-w-[390px] w-full flex-col items-center text-center shadow-[0_40px_80px_rgba(0,0,0,0.55)]"
            style={{
              backgroundColor: 'rgba(15, 15, 15, 0.72)',
              backdropFilter: 'blur(30px)',
              WebkitBackdropFilter: 'blur(30px)',
              borderRadius: '0px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              padding: '2.5rem 1.75rem 2rem'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowAppPromptModal(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Brand Logo */}
            <img 
              src="/logo-white.png" 
              alt="Misty Visuals" 
              style={{ height: '3.25rem', width: 'auto', objectFit: 'contain', marginBottom: '1.25rem' }} 
            />

            {/* Heading */}
            <h2 style={{
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '1rem',
              fontWeight: 500,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              textAlign: 'center',
              marginBottom: '0.35rem',
              color: '#ffffff'
            }}>
              View in App
            </h2>

            {/* Event title */}
            {event?.title && (
              <p style={{
                fontFamily: '"Montserrat", system-ui, sans-serif',
                fontSize: '0.75rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(255, 255, 255, 0.65)',
                textAlign: 'center',
                marginBottom: '1.5rem'
              }}>
                {(event.title || '').replace(/'s\s+Wedding/gi, '').replace('&', '').replace(/\s+/g, ' ').trim()}
              </p>
            )}

            {/* High-contrast QR Code */}
            <div style={{
              backgroundColor: '#ffffff',
              padding: '10px',
              borderRadius: '12px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              marginBottom: '0.65rem'
            }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=0&data=${encodeURIComponent(`https://mycircle.mistyvisuals.com/${slug}/gallery`)}`}
                alt="Scan with your phone"
                style={{ width: '130px', height: '130px', display: 'block' }}
              />
            </div>

            <p style={{
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '0.6875rem',
              letterSpacing: '0.04em',
              color: 'rgba(255, 255, 255, 0.65)',
              textAlign: 'center',
              marginBottom: '1.5rem'
            }}>
              Scan with your phone camera to view in the app
            </p>

            {/* Official Badges side-by-side like in ss2 */}
            <div style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              width: '100%'
            }}>
              {/* Apple App Store Badge */}
              <a
                href="https://apps.apple.com/app/id6796633077"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: '#000000',
                  border: '1px solid rgba(255, 255, 255, 0.35)',
                  borderRadius: '8px',
                  padding: '0.45rem 0.65rem',
                  textDecoration: 'none',
                  flex: 1,
                  minWidth: 0,
                  justifyContent: 'center',
                  transition: 'all 0.15s ease'
                }}
                className="hover:border-white/70 active:scale-95"
              >
                <svg className="w-5 h-5 fill-current text-white shrink-0" viewBox="0 0 170 170">
                  <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.58-7.73-11.65-14.07-5.59-8.7-10.05-18.73-13.38-30.09-3.33-11.36-5-22.18-5-32.47 0-14.36 3.6-26.35 10.79-35.97 7.19-9.62 16.48-14.54 27.87-14.76 4.9 0 10.15 1.25 15.75 3.76 5.61 2.51 9.4 3.82 11.39 3.93 1.63-.11 5.76-1.55 12.39-4.33 6.63-2.77 12.3-3.95 17.02-3.53 13.06.87 23.46 5.92 31.2 15.15-11.43 6.86-17.02 16.53-16.78 29.01.24 9.69 3.96 17.89 11.16 24.6 7.2 6.71 15.86 10.51 25.98 11.4-2.61 7.63-5.77 15.31-9.48 23.06zM119.22 31.84c0-7.29 2.58-14.15 7.74-20.58 5.16-6.43 11.65-10.59 19.47-12.49.22 1.09.33 2.18.33 3.27 0 7.29-2.67 14.28-8.01 20.97-5.34 6.69-11.89 10.9-19.65 12.63-.11-1.3-.22-2.56-.33-3.8z" />
                </svg>
                <div className="flex flex-col text-left ml-1.5 leading-tight">
                  <span style={{ fontSize: '8px', color: '#d4d4d4', letterSpacing: '-0.01em', fontWeight: 400, textTransform: 'none' }}>Download on the</span>
                  <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: 600, letterSpacing: '-0.02em', textTransform: 'none' }}>App Store</span>
                </div>
              </a>

              {/* Google Play Badge */}
              <a
                href={`https://play.google.com/store/apps/details?id=com.mistyvisuals.mycircle&referrer=slug%3D${encodeURIComponent(slug)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: '#000000',
                  border: '1px solid rgba(255, 255, 255, 0.35)',
                  borderRadius: '8px',
                  padding: '0.45rem 0.65rem',
                  textDecoration: 'none',
                  flex: 1,
                  minWidth: 0,
                  justifyContent: 'center',
                  transition: 'all 0.15s ease'
                }}
                className="hover:border-white/70 active:scale-95"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 512 512">
                  <path fill="#00C1A6" d="M302.2 240.2L81.5 19.5C76.9 24.1 74.3 30.4 74.3 37.4v437.2c0 7 2.6 13.3 7.2 17.9l220.7-220.7v-31.6z"/>
                  <path fill="#FFD400" d="M375.4 313.4l-73.2-73.2v-31.6l73.2-73.2 8.3 4.7 98.7 56.1c8.1 4.6 13.1 13.1 13.1 22.4s-5 17.8-13.1 22.4l-98.7 56.1-8.3 4.7z"/>
                  <path fill="#FF334B" d="M81.5 492.5c4.7 4.7 11.1 7.2 17.9 7.2 4.1 0 8.1-.9 11.9-2.8l264.1-149.9-73.2-73.2L81.5 492.5z"/>
                  <path fill="#00E676" d="M302.2 240.2l73.2-73.2L111.3 17.1c-3.8-1.9-7.8-2.8-11.9-2.8-6.8 0-13.2 2.5-17.9 7.2l220.7 218.7z"/>
                </svg>
                <div className="flex flex-col text-left ml-1.5 leading-tight">
                  <span style={{ fontSize: '8px', color: '#d4d4d4', letterSpacing: '-0.01em', fontWeight: 400, textTransform: 'uppercase' }}>GET IT ON</span>
                  <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: 600, letterSpacing: '-0.02em', textTransform: 'none' }}>Google Play</span>
                </div>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Shared Login Flow overlay components */}
      <GuestLoginFlow
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={handleLoginSuccess}
        eventSlug={slug}
        inviteCode={inviteCode}
        initialToken={existingToken}
        initialProfile={existingProfile}
        eventHasPasscode={event?.hasPasscode}
        circleToken={circleToken}
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
          transition: background 0.3s, border-color 0.3s, color 0.3s;
        }
        .cover-cta:hover {
          background-color: #ffffff;
          border-color: #ffffff;
          color: #000000;
        }
      `}</style>
    </div>
  )
}
