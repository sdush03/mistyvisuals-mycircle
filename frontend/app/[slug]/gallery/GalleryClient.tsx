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
  const [inviteCode, setInviteCode] = useState<string | undefined>(undefined)
  const [existingToken, setExistingToken] = useState<string | undefined>(undefined)
  const [existingProfile, setExistingProfile] = useState<any>(null)

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const code = searchParams.get('code')
    if (code) {
      setInviteCode(code)
    }

    const pToken = searchParams.get('previewToken')
    if (pToken) {
      localStorage.setItem(`mv_gallery_preview_token_${slug}`, pToken)
    }

    const activePreviewToken = pToken || localStorage.getItem(`mv_gallery_preview_token_${slug}`)
    const fetchUrl = activePreviewToken
      ? `${apiUrl}/api/gallery/public/events/${slug}?previewToken=${activePreviewToken}`
      : `${apiUrl}/api/gallery/public/events/${slug}`

    // 1. Fetch public event details
    fetch(fetchUrl)
      .then(res => {
        if (!res.ok) throw new Error('Gallery not found or inactive')
        return res.json()
      })
      .then(async data => {
        setEvent(data)

        // Check if admin preview mode is active
        if (data.isPreviewMode) {
          const previewToken = activePreviewToken || ''
          const localGuest = {
            id: 999999,
            name: 'Admin Preview',
            email: 'admin@mistyvisuals.com',
            phoneNumber: '9999999999',
            hasSelfie: true,
            hasFullAccess: true,
            isPreviewMode: true
          }
          localStorage.setItem(`mv_gallery_token_${slug}`, previewToken)
          localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(localGuest))
          setGuest(localGuest)
          router.push(`/${slug}/gallery/photos`)
          return
        }

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
                
                // Only bypass if both are complete
                if (localGuest.phoneNumber && localGuest.hasSelfie) {
                  localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(localGuest))
                  setGuest(localGuest)
                  // Keep loading: true so the spinner stays visible during Next.js router.push navigation
                  router.push(`/${slug}/gallery/photos`)
                  return
                }
              }
            }
          } catch (syncErr) {
            console.error('Failed to sync guest session:', syncErr)
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
    setLoading(true) // Show the loading spinner while Next.js transitions to the photos grid
    localStorage.setItem(`mv_gallery_token_${slug}`, token)
    localStorage.setItem(`mv_gallery_guest_${slug}`, JSON.stringify(profile))
    setGuest(profile)
    setShowLoginModal(false)
    router.push(`/${slug}/gallery/photos`)
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
        {/* Decorative subtle ambient lights */}
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
          {/* Header Logo */}
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

          {/* Status Icon */}
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

          {/* Heading */}
          <h1 className="font-lora text-2xl font-semibold text-[#1c1a18] tracking-wide mb-3">
            {isUnpublished ? 'Gallery Unpublished' : 'Connection Offline'}
          </h1>

          {/* Message */}
          <p className="font-sans text-sm text-neutral-500 leading-relaxed mb-8 px-2 max-w-sm">
            {isUnpublished 
              ? 'This photo gallery is currently set to private or has not been published yet. Please check back later or contact your photographer/host for access details.' 
              : error}
          </p>

          {/* CTAs */}
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
          setShowLoginModal(true)
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
      `}</style>
    </div>
  )
}
