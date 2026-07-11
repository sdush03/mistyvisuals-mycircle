'use client'

import React, { useState, useEffect, useRef } from 'react'

interface CameraCaptureModalProps {
  isOpen: boolean
  onClose: () => void
  onCapture: (dataUrl: string) => void
  title?: string
  status?: 'idle' | 'verifying' | 'accepted' | 'rejected'
  feedbackMessage?: string | null
  onContinue?: () => void
  onGoBackCustom?: () => void
  onRetake?: () => void
}

export function CameraCaptureModal({
  isOpen,
  onClose,
  onCapture,
  title = 'Capture Selfie',
  status = 'idle',
  feedbackMessage = null,
  onContinue,
  onGoBackCustom,
  onRetake
}: CameraCaptureModalProps) {
  const [cameraActive, setCameraActive] = useState<boolean>(false)
  const [tempSelfiePreview, setTempSelfiePreview] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [showIntro, setShowIntro] = useState<boolean>(true)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const isOpenRef = useRef(isOpen)
  const showIntroRef = useRef(showIntro)

  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  useEffect(() => {
    showIntroRef.current = showIntro
  }, [showIntro])

  const startCamera = async () => {
    setCameraError(null)
    setTempSelfiePreview(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } }
      })

      // Check if modal was closed or intro shown while getUserMedia was resolving
      if (!isOpenRef.current || showIntroRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      streamRef.current = stream
      setCameraActive(true)
    } catch (err: any) {
      console.error('Camera access failed:', err)
      setCameraActive(false)
      setCameraError('Camera not accessible. Please check your browser permissions.')
    }
  }

  const stopCamera = () => {
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }

  const capturePhoto = () => {
    if (!videoRef.current) return
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    const size = Math.min(video.videoWidth, video.videoHeight)
    canvas.width = size
    canvas.height = size
    
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.translate(size, 0)
      ctx.scale(-1, 1)
      const sx = (video.videoWidth - size) / 2
      const sy = (video.videoHeight - size) / 2
      ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size)
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
      setTempSelfiePreview(dataUrl)
      stopCamera()
      onCapture(dataUrl)
    }
  }

  const handleRetake = () => {
    setTempSelfiePreview(null)
    startCamera()
    if (onRetake) {
      onRetake()
    }
  }

  const handleUsePhoto = () => {
    if (tempSelfiePreview) {
      onCapture(tempSelfiePreview)
    }
    onClose()
  }

  useEffect(() => {
    if (isOpen) {
      if (status === 'idle') {
        setShowIntro(true)
      } else {
        setShowIntro(false)
      }
    }
  }, [isOpen, status])

  useEffect(() => {
    if (isOpen && !showIntro) {
      const timer = setTimeout(() => {
        startCamera()
      }, 100)
      return () => {
        clearTimeout(timer)
      }
    } else {
      stopCamera()
    }
  }, [isOpen, showIntro])

  // If status is reset to idle by parent, reset local preview too
  useEffect(() => {
    if (status === 'idle') {
      setTempSelfiePreview(null)
    }
  }, [status])

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  if (!isOpen) return null

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        padding: '1rem'
      }}
    >
      <div 
        style={{
          width: '100%',
          maxWidth: '400px',
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
        {showIntro ? (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
            <h3 style={{
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '1.25rem',
              fontWeight: 500,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              textAlign: 'center',
              marginBottom: '1rem',
              color: '#ffffff'
            }}>
              Register Your Face
            </h3>
            <p style={{
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '0.8rem',
              color: '#a3a3a3',
              textAlign: 'center',
              lineHeight: 1.6,
              marginBottom: '2rem'
            }}>
              Misty Visuals uses AI face matching to instantly find your photos in the wedding gallery.
            </p>
            
            <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.15)', marginBottom: '2rem' }} />

            {/* Bullet Points */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '2.5rem' }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.2rem', marginTop: '-0.1rem' }}>🕶️</span>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#ffffff', fontFamily: '"Montserrat", sans-serif' }}>
                    Remove Accessories
                  </h4>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: '#a3a3a3', fontFamily: '"Montserrat", sans-serif' }}>
                    Take off sunglasses, hats, or masks.
                  </p>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.2rem', marginTop: '-0.1rem' }}>💡</span>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#ffffff', fontFamily: '"Montserrat", sans-serif' }}>
                    Clear Lighting
                  </h4>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: '#a3a3a3', fontFamily: '"Montserrat", sans-serif' }}>
                    Ensure light faces you directly (avoid backlighting).
                  </p>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.2rem', marginTop: '-0.1rem' }}>😐</span>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#ffffff', fontFamily: '"Montserrat", sans-serif' }}>
                    Expression & Angle
                  </h4>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: '#a3a3a3', fontFamily: '"Montserrat", sans-serif' }}>
                    Look straight into the lens with a neutral face or light smile.
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <button
              type="button"
              onClick={() => {
                setShowIntro(false)
              }}
              style={{
                width: '100%',
                padding: '1.1rem',
                backgroundColor: '#ffffff',
                color: '#000000',
                border: 'none',
                fontFamily: '"Montserrat", system-ui, sans-serif',
                fontSize: '0.8rem',
                fontWeight: 600,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                marginBottom: '1rem'
              }}
            >
              Open Camera
            </button>
            <button
              type="button"
              onClick={onGoBackCustom || onClose}
              style={{
                fontSize: '0.65rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'rgba(255, 255, 255, 0.4)',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'color 0.2s ease',
                fontFamily: '"Montserrat", system-ui, sans-serif',
                textAlign: 'center',
                width: '100%'
              }}
              onMouseOver={(e) => e.currentTarget.style.color = '#ffffff'}
              onMouseOut={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)'}
            >
              Go Back
            </button>
          </div>
        ) : (
          <>
            <h3 style={{
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '1rem',
              fontWeight: 500,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              textAlign: 'center',
              marginBottom: '1.5rem',
              color: '#ffffff'
            }}>
              {title}
            </h3>

            {/* Camera / Preview Box */}
            <div style={{ 
              position: 'relative', 
              width: '280px', 
              height: '280px', 
              overflow: 'hidden', 
              backgroundColor: '#000000',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              marginBottom: '1.5rem'
            }}>
              {!tempSelfiePreview ? (
                <>
                  <video 
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'cover',
                      display: cameraActive ? 'block' : 'none',
                      transform: 'scaleX(-1)'
                    }}
                  />
                  {!cameraActive && (
                    <div style={{ 
                      width: '100%', 
                      height: '100%', 
                      display: 'flex', 
                      flexDirection: 'column',
                      alignItems: 'center', 
                      justifyContent: 'center',
                      padding: '1.5rem',
                      textAlign: 'center'
                    }}>
                      <p style={{
                        fontFamily: '"Montserrat", system-ui, sans-serif',
                        fontSize: '0.7rem',
                        color: '#a3a3a3',
                        marginBottom: '1rem'
                      }}>
                        {cameraError || 'Webcam is loading or unavailable.'}
                      </p>
                    </div>
                  )}
                  {cameraActive && (
                    <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 280 280">
                      <defs>
                        <mask id="stencil-mask">
                          <rect width="280" height="280" fill="#ffffff" />
                          <ellipse cx="140" cy="140" rx="80" ry="110" fill="#000000" />
                        </mask>
                      </defs>
                      <rect width="280" height="280" fill="rgba(0, 0, 0, 0.6)" mask="url(#stencil-mask)" />
                      <ellipse cx="140" cy="140" rx="80" ry="110" fill="none" stroke="#ffffff" strokeWidth="2" strokeDasharray="6 4" style={{ opacity: 0.6 }} />
                    </svg>
                  )}
                </>
              ) : (
                <img 
                  src={tempSelfiePreview} 
                  alt="Selfie Preview" 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
            </div>

            {/* Verification Status Feedback (Inline) */}
            {status === 'verifying' && (
              <p style={{
                fontFamily: '"Montserrat", system-ui, sans-serif',
                fontSize: '0.7rem',
                color: '#ffffff',
                textAlign: 'center',
                lineHeight: 1.4,
                marginBottom: '1.5rem',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                padding: '0.75rem 1rem',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                width: '100%',
                boxSizing: 'border-box'
              }}>
                ⏳ Verifying selfie quality...
              </p>
            )}

            {status === 'accepted' && (
              <p style={{
                fontFamily: '"Montserrat", system-ui, sans-serif',
                fontSize: '0.7rem',
                color: '#4ade80',
                textAlign: 'center',
                lineHeight: 1.4,
                marginBottom: '1.5rem',
                backgroundColor: 'rgba(74, 222, 128, 0.1)',
                padding: '0.75rem 1rem',
                border: '1px solid rgba(74, 222, 128, 0.2)',
                width: '100%',
                boxSizing: 'border-box'
              }}>
                ✅ Selfie Accepted! You look optimal.
              </p>
            )}

            {status === 'rejected' && feedbackMessage && (
              <p style={{
                fontFamily: '"Montserrat", system-ui, sans-serif',
                fontSize: '0.7rem',
                color: '#ff4d4d',
                textAlign: 'center',
                lineHeight: 1.4,
                marginBottom: '1.5rem',
                backgroundColor: 'rgba(255, 77, 77, 0.1)',
                padding: '0.75rem 1rem',
                border: '1px solid rgba(255, 77, 77, 0.2)',
                width: '100%',
                boxSizing: 'border-box'
              }}>
                ❌ {feedbackMessage}
              </p>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
              {/* 1. Verifying State */}
              {status === 'verifying' && (
                <button
                  disabled
                  style={{
                    width: '100%',
                    padding: '0.9rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    color: 'rgba(255, 255, 255, 0.4)',
                    border: 'none',
                    fontFamily: '"Montserrat", system-ui, sans-serif',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    cursor: 'not-allowed',
                  }}
                >
                  Verifying Face...
                </button>
              )}

              {/* 2. Accepted State */}
              {status === 'accepted' && onContinue && (
                <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
                  <button
                    type="button"
                    onClick={handleRetake}
                    style={{
                      flex: 1,
                      padding: '0.9rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      color: '#ffffff',
                      border: '1px solid rgba(255, 255, 255, 0.25)',
                      fontFamily: '"Montserrat", system-ui, sans-serif',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    Retake
                  </button>
                  <button
                    type="button"
                    onClick={onContinue}
                    style={{
                      flex: 2,
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
                    }}
                  >
                    Continue →
                  </button>
                </div>
              )}

              {/* 3. Rejected State */}
              {status === 'rejected' && (
                <button
                  type="button"
                  onClick={handleRetake}
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
                  }}
                >
                  Retake Selfie
                </button>
              )}

              {/* 4. Idle / Default Flow */}
              {status === 'idle' && (
                <>
                  {!tempSelfiePreview && cameraActive && (
                    <button
                      type="button"
                      onClick={capturePhoto}
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
                      }}
                    >
                      📸 SNAP SELFIE
                    </button>
                  )}

                  {tempSelfiePreview && (
                    <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
                      <button
                        type="button"
                        onClick={handleRetake}
                        style={{
                          flex: 1,
                          padding: '0.9rem',
                          backgroundColor: 'rgba(255, 255, 255, 0.1)',
                          color: '#ffffff',
                          border: '1px solid rgba(255, 255, 255, 0.25)',
                          fontFamily: '"Montserrat", system-ui, sans-serif',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                        }}
                      >
                        Retake
                      </button>
                      <button
                        type="button"
                        onClick={handleUsePhoto}
                        style={{
                          flex: 2,
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
                        }}
                      >
                        Use Photo ✓
                      </button>
                    </div>
                  )}
                </>
              )}

              <button
                type="button"
                onClick={onGoBackCustom || onClose}
                style={{
                  marginTop: '1rem',
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
          </>
        )}
      </div>
    </div>
  )
}
