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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const code = searchParams.get('code')
    if (code) {
      setInviteCode(code)
    }

    // 1. Fetch public event details
    fetch(`${apiUrl}/api/gallery/public/events/${slug}`)
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
