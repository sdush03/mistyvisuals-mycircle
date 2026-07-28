'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Script from 'next/script'
import { CameraCaptureModal } from './CameraCaptureModal'

interface GuestProfile {
  id: number
  name: string
  email: string
  phoneNumber?: string | null
  hasSelfie?: boolean
  hasFullAccess?: boolean
}

interface GuestLoginFlowProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (profile: GuestProfile, token: string) => void
  eventSlug?: string
  inviteCode?: string
  initialToken?: string
  initialProfile?: GuestProfile | null
  eventHasPasscode?: boolean
  circleToken?: string
}

export function GuestLoginFlow({
  isOpen,
  onClose,
  onSuccess,
  eventSlug,
  inviteCode,
  initialToken,
  initialProfile,
  eventHasPasscode,
  circleToken
}: GuestLoginFlowProps) {
  const [showPhoneModal, setShowPhoneModal] = useState(false)
  const [showSelfieCapture, setShowSelfieCapture] = useState(false)
  
  const [phoneNumber, setPhoneNumber] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [submittingPhone, setSubmittingPhone] = useState(false)

  const [validationStatus, setValidationStatus] = useState<'idle' | 'verifying' | 'accepted' | 'rejected'>('idle')
  const [selfieError, setSelfieError] = useState('')
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
  
  const [tempToken, setTempToken] = useState<string | null>(initialToken || null)
  const [tempProfile, setTempProfile] = useState<GuestProfile | null>(initialProfile || null)
  // Ref keeps token+profile stable even if React re-runs the isOpen effect and resets state
  const authSessionRef = useRef<{ token: string; profile: GuestProfile } | null>(
    initialToken && initialProfile ? { token: initialToken, profile: initialProfile } : null
  )

  const [pendingOauthToken, setPendingOauthToken] = useState<string | null>(null)
  const [pendingOauthProvider, setPendingOauthProvider] = useState<string | null>(null)
  const [showPasscodeScreenAfterAuth, setShowPasscodeScreenAfterAuth] = useState(false)
  const [submittingPasscode, setSubmittingPasscode] = useState(false)

  const [activeCode, setActiveCode] = useState(inviteCode || '')
  const [passcodeInput, setPasscodeInput] = useState('')
  const [passcodeError, setPasscodeError] = useState('')

  const [verifyingCircle, setVerifyingCircle] = useState(false)


  useEffect(() => {
    if (inviteCode) {
      setActiveCode(inviteCode)
    }
  }, [inviteCode])

  useEffect(() => {
    if (isOpen) {
      if (initialToken && initialProfile) {
        setTempToken(initialToken)
        setTempProfile(initialProfile)
        
        if (!initialProfile.phoneNumber) {
          setShowPhoneModal(true)
          setShowSelfieCapture(false)
        } else if (!initialProfile.hasSelfie) {
          setShowSelfieCapture(true)
          setShowPhoneModal(false)
        } else {
          onSuccess(initialProfile, initialToken)
        }
      } else {
        setTempToken(null)
        setTempProfile(null)
        setShowPhoneModal(false)
        setShowSelfieCapture(false)
        
        if (circleToken) {
          setPendingOauthToken(circleToken)
          setPendingOauthProvider('circle')
          const codeToUse = inviteCode || activeCode
          if (codeToUse) {
            setVerifyingCircle(true)
            authenticateAndContinue(circleToken, 'circle', codeToUse)
              .catch(() => {
                setShowPasscodeScreenAfterAuth(true)
                setPasscodeInput('')
                setPasscodeError('')
              })
              .finally(() => {
                setVerifyingCircle(false)
              })
          } else {
            setShowPasscodeScreenAfterAuth(true)
            setPasscodeInput('')
            setPasscodeError('')
          }
        } else {
          // Reset OAuth states
          setPendingOauthToken(null)
          setPendingOauthProvider(null)
          setShowPasscodeScreenAfterAuth(false)
          setPasscodeInput('')
          setPasscodeError('')
          setVerifyingCircle(false)
        }
      }
    }
  }, [isOpen, initialToken, initialProfile, circleToken, inviteCode, activeCode])

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3004'


  // Custom Google Sign-In using OAuth popup with prompt=select_account
  // This bypasses Google SDK's FedCM / auto-select and always shows the account chooser
  const handleGoogleSignIn = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '1051090030242-du725l33veu6vl637lo1jpgpka1ilujj.apps.googleusercontent.com'
    const redirectUri = typeof window !== 'undefined' ? `${window.location.origin}/auth/google/callback` : ''
    const nonce = Math.random().toString(36).substring(2)

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'id_token',
      scope: 'openid email profile',
      prompt: 'select_account',
      nonce,
    })

    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

    const popup = window.open(
      oauthUrl,
      'google-signin',
      'width=500,height=600,left=100,top=100,scrollbars=yes'
    )

    // Listen for the id_token coming back from the popup via postMessage
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'google-auth' && event.data?.id_token) {
        window.removeEventListener('message', handleMessage)
        popup?.close()
        try {
          const code = activeCode || inviteCode
          await authenticateAndContinue(event.data.id_token, 'google', code)
        } catch (err: any) {
          if (err.message && (err.message.includes('passcode') || err.message.includes('Passcode'))) {
            setPendingOauthToken(event.data.id_token)
            setPendingOauthProvider('google')
            setShowPasscodeScreenAfterAuth(true)
            setPasscodeError('')
          } else {
            alert(err.message || 'Login failed')
          }
        }
      }
    }

    window.addEventListener('message', handleMessage)

    // Cleanup listener if popup is closed without completing auth
    const pollClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(pollClosed)
        window.removeEventListener('message', handleMessage)
      }
    }, 500)
  }

  // Lock body scroll when login overlay is active
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const authenticateAndContinue = async (oauthToken: string, provider: string, code?: string) => {
    const isCircle = provider === 'circle'
    const authUrl = eventSlug 
      ? (isCircle
          ? `${apiUrl}/api/gallery/public/events/${eventSlug}/auth-from-family`
          : `${apiUrl}/api/gallery/public/events/${eventSlug}/auth`)
      : `${apiUrl}/api/gallery/family/auth`

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (isCircle) {
      headers['Authorization'] = `Bearer ${oauthToken}`
    }

    const res = await fetch(authUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        token: isCircle ? undefined : oauthToken, 
        provider: isCircle ? undefined : provider,
        code
      })
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error(data.error || 'Authentication failed')
    }
    
    const sessionToken = data.token
    const profile: GuestProfile = data.guest || data.profile

    setTempToken(sessionToken)
    setTempProfile(profile)
    // Store in ref so selfie/continue handlers always have a stable reference
    authSessionRef.current = { token: sessionToken, profile }

    // Reset pending OAuth states
    setPendingOauthToken(null)
    setPendingOauthProvider(null)
    setShowPasscodeScreenAfterAuth(false)

    // Determine next steps in the flow
    if (!profile.phoneNumber) {
      setShowPhoneModal(true)
      setShowSelfieCapture(false)
    } else if (!profile.hasSelfie) {
      setShowSelfieCapture(true)
      setShowPhoneModal(false)
    } else {
      onSuccess(profile, sessionToken)
    }
  }


  const handlePasscodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passcodeInput.trim()) {
      setPasscodeError('Passcode cannot be empty')
      return
    }
    setPasscodeError('')

    if (!pendingOauthToken || !pendingOauthProvider) {
      setPasscodeError('Authentication session expired. Please sign in again.')
      return
    }

    try {
      setSubmittingPasscode(true)
      await authenticateAndContinue(pendingOauthToken, pendingOauthProvider, passcodeInput.trim())
    } catch (err: any) {
      setPasscodeError(err.message || 'Invalid passcode')
    } finally {
      setSubmittingPasscode(false)
    }
  }

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tempToken || !tempProfile) return

    const sanitized = phoneNumber.replace(/\D/g, '')
    if (sanitized.length < 10) {
      setPhoneError('Please enter a valid 10-digit mobile number')
      return
    }

    setPhoneError('')
    setSubmittingPhone(true)

    try {
      // 3. Save phone number
      const updateUrl = eventSlug
        ? `${apiUrl}/api/gallery/public/events/${eventSlug}/phone`
        : `${apiUrl}/api/gallery/family/profile/update`

      const bodyPayload = eventSlug
        ? JSON.stringify({ phoneNumber: sanitized })
        : JSON.stringify({ phoneNumber: sanitized, name: tempProfile.name })

      const res = await fetch(updateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tempToken}`
        },
        body: bodyPayload
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update phone number')

      const updatedProfile = { ...tempProfile, phoneNumber: sanitized }
      setTempProfile(updatedProfile)
      setShowPhoneModal(false)

      // 4. Continue flow to selfie capture
      if (!updatedProfile.hasSelfie) {
        setShowSelfieCapture(true)
      } else {
        onSuccess(updatedProfile, tempToken)
      }
    } catch (err: any) {
      setPhoneError(err.message)
    } finally {
      setSubmittingPhone(false)
    }
  }

  const handleCameraCapture = (dataUrl: string) => {
    setSelfiePreview(dataUrl)
    verifySelfie(dataUrl)
  }

  const verifySelfie = async (dataUrl: string) => {
    const session = authSessionRef.current
    if (!session) return
    const { token: sessionToken, profile: sessionProfile } = session
    setValidationStatus('verifying')
    setSelfieError('')

    try {
      const fetchRes = await fetch(dataUrl)
      const blob = await fetchRes.blob()
      const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' })

      const formData = new FormData()
      
      const uploadUrl = eventSlug
        ? `${apiUrl}/api/gallery/public/events/${eventSlug}/selfie`
        : `${apiUrl}/api/gallery/family/profile/update`

      if (eventSlug) {
        formData.append('selfie', file)
      } else {
        formData.append('selfie', file)
        formData.append('phoneNumber', sessionProfile.phoneNumber || '')
        formData.append('name', sessionProfile.name)
      }

      let attempts = 0
      const maxAttempts = 5
      const retryDelay = 3000

      const executeUpload = async (): Promise<any> => {
        try {
          const res = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${sessionToken}`
            },
            body: formData
          })

          if (res.status === 502 || res.status === 503 || res.status === 504) {
            throw new Error('Server is updating')
          }

          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Failed to verify selfie.')
          return data
        } catch (err: any) {
          const isNetworkOrUpdateError = err instanceof TypeError || err.message === 'Server is updating' || err.message.includes('fetch')
          if (isNetworkOrUpdateError && attempts < maxAttempts) {
            attempts++
            setSelfieError('We are performing a quick system update. This may take a few minutes. Please wait...')
            await new Promise(resolve => setTimeout(resolve, retryDelay))
            return executeUpload()
          }
          throw err
        }
      }

      await executeUpload()
      setValidationStatus('accepted')
      setSelfieError('')
    } catch (err: any) {
      setValidationStatus('rejected')
      setSelfieError(err.message || 'Verification failed. Please retake the photo.')
    }
  }

  const handleContinueToGallery = () => {
    const session = authSessionRef.current
    if (validationStatus !== 'accepted' || !session) return
    const finalProfile = { ...session.profile, hasSelfie: true }
    onSuccess(finalProfile, session.token)
  }

  const handleBackOut = () => {
    // Reset state & close everything
    setShowPhoneModal(false)
    setShowSelfieCapture(false)
    setPhoneNumber('')
    setPhoneError('')
    setTempToken(null)
    setTempProfile(null)
    setValidationStatus('idle')
    setSelfieError('')
    setSelfiePreview(null)
    onClose()
  }

  return (
    <>
      <Script 
        src="https://accounts.google.com/gsi/client" 
        strategy="afterInteractive"
      />

      {/* Main Login Overlay Modal */}
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
          opacity: (isOpen && !showPhoneModal && !showSelfieCapture) ? 1 : 0,
          visibility: (isOpen && !showPhoneModal && !showSelfieCapture) ? 'visible' : 'hidden',
          pointerEvents: (isOpen && !showPhoneModal && !showSelfieCapture) ? 'auto' : 'none',
          transition: 'opacity 0.3s ease, visibility 0.3s ease'
        }}
        onClick={(e) => { e.stopPropagation(); handleBackOut(); }}
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
            transform: (isOpen && !showPhoneModal && !showSelfieCapture) ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(12px)',
            transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
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
            {verifyingCircle 
              ? 'Verifying Session' 
              : (showPasscodeScreenAfterAuth || circleToken ? 'Enter Passcode' : 'Welcome Guests')}
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
            {verifyingCircle 
              ? 'Please wait while we verify your invite using My Circle.'
              : (showPasscodeScreenAfterAuth || circleToken
                  ? 'Enter the passcode shared by the couple to access their gallery.'
                  : 'Log in with your social account to instantly find your photos using AI face recognition.')}
          </p>

          {verifyingCircle ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '2rem 0' }}>
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#ffffff] border-t-transparent mb-2"></div>
              <p style={{ fontFamily: '"Montserrat", sans-serif', fontSize: '0.75rem', color: '#a3a3a3' }}>
                Signing you in...
              </p>
            </div>
          ) : (circleToken || showPasscodeScreenAfterAuth) ? (
            <form 
              onSubmit={handlePasscodeSubmit}
              style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', width: '280px' }}>
                <input 
                  type="text"
                  placeholder="Enter Passcode"
                  value={passcodeInput}
                  onChange={(e) => setPasscodeInput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.9rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#ffffff',
                    fontFamily: '"Montserrat", system-ui, sans-serif',
                    fontSize: '0.8rem',
                    textAlign: 'center',
                    boxSizing: 'border-box',
                    letterSpacing: '0.1em'
                  }}
                />
                {passcodeError && (
                  <span style={{ color: '#ff4d4d', fontSize: '0.65rem', fontFamily: '"Montserrat", sans-serif', marginTop: '0.5rem', textAlign: 'center' }}>
                    {passcodeError}
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={submittingPasscode}
                style={{
                  width: '280px',
                  padding: '1rem',
                  backgroundColor: '#ffffff',
                  color: '#000000',
                  border: 'none',
                  fontFamily: '"Montserrat", system-ui, sans-serif',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  opacity: submittingPasscode ? 0.6 : 1,
                  transition: 'opacity 0.2s'
                }}
              >
                {submittingPasscode ? 'Verifying...' : 'Submit'}
              </button>
            </form>
          ) : (
            <>
              {/* OAuth Buttons Container */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', alignItems: 'center' }}>
                {/* Custom Google Sign-In button — always shows account chooser via prompt=select_account */}
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.75rem',
                    width: '280px',
                    height: '44px',
                    background: '#fff',
                    border: 'none',
                    borderRadius: '2px',
                    padding: '0 1rem',
                    color: '#3c4043',
                    fontFamily: '"Roboto", system-ui, sans-serif',
                    fontSize: '14px',
                    fontWeight: 500,
                    letterSpacing: '0.02em',
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>

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
            </>
          )}

          {!verifyingCircle && (
            <button 
              onClick={(e) => { 
                e.stopPropagation(); 
                if (circleToken) {
                  onClose();
                } else if (showPasscodeScreenAfterAuth) {
                  setShowPasscodeScreenAfterAuth(false)
                  setPendingOauthToken(null)
                  setPendingOauthProvider(null)
                  setPasscodeInput('')
                  setPasscodeError('')
                } else {
                  handleBackOut(); 
                }
              }}
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
              {(circleToken || showPasscodeScreenAfterAuth) ? 'Cancel' : 'Go Back'}
            </button>
          )}
        </div>
      </div>

      {/* Phone Number Modal */}
      {showPhoneModal && (
        <div 
          onClick={(e) => { e.stopPropagation(); }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(8px)',
            padding: '0 2rem'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '380px',
              backgroundColor: 'rgba(15, 15, 15, 0.65)',
              backdropFilter: 'blur(30px)',
              borderRadius: '0px',
              padding: '3rem 2.5rem 2.5rem',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '0 40px 80px rgba(0, 0, 0, 0.45)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}
          >
            <h3 style={{
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '1.1rem',
              fontWeight: 500,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              textAlign: 'center',
              marginBottom: '1rem',
              color: '#ffffff'
            }}>
              Verification Required
            </h3>
            <p style={{
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '0.75rem',
              color: '#a3a3a3',
              textAlign: 'center',
              lineHeight: 1.5,
              marginBottom: '2rem'
            }}>
              Enter your phone number so we can notify you if additional photos are uploaded to the gallery.
            </p>

            <form onSubmit={handlePhoneSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                <input 
                  type="tel"
                  placeholder="Enter 10-digit phone number"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.9rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#ffffff',
                    fontFamily: '"Montserrat", system-ui, sans-serif',
                    fontSize: '0.8rem',
                    textAlign: 'center',
                    boxSizing: 'border-box'
                  }}
                />
                {phoneError && (
                  <span style={{ color: '#ff4d4d', fontSize: '0.65rem', fontFamily: '"Montserrat", sans-serif', marginTop: '0.5rem', textAlign: 'center' }}>
                    {phoneError}
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={submittingPhone}
                style={{
                  width: '100%',
                  padding: '1rem',
                  backgroundColor: '#ffffff',
                  color: '#000000',
                  border: 'none',
                  fontFamily: '"Montserrat", system-ui, sans-serif',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  letterSpacing: '0.15em',
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
              onClick={handleBackOut}
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

      {/* Camera Modal */}
      <CameraCaptureModal
        isOpen={showSelfieCapture}
        onClose={handleBackOut}
        onCapture={handleCameraCapture}
        status={validationStatus}
        feedbackMessage={selfieError}
        onContinue={handleContinueToGallery}
        onRetake={() => {
          setValidationStatus('idle')
          setSelfieError('')
          setSelfiePreview(null)
        }}
      />
    </>
  )
}
