'use client'

import React from 'react'

export default function Footer() {
  return (
    <footer style={{ background: '#ffffff', borderTop: '1px solid #e6e3d9', marginTop: '4rem', width: '100%' }}>
      <div style={{
        padding: 'clamp(3rem,6vh,5rem) clamp(1.5rem, 5vw, 5rem) clamp(2rem,4vh,3rem)',
        maxWidth: '1600px',
        margin: '0 auto',
        textAlign: 'left'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr',
          gap: 'clamp(2rem,4vw,4rem)',
          marginBottom: 'clamp(2.5rem,5vh,4rem)',
        }} className="footer-grid">

          {/* Brand column */}
          <div>
            <p style={{
              fontFamily: '"Futura", "Trebuchet MS", Arial, sans-serif',
              fontSize: 'clamp(1rem,1.6vw,1.375rem)',
              fontWeight: 400,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: '#1c1a18',
              marginBottom: '1rem',
              margin: 0
            }}>
              Misty Visuals
            </p>
            <p style={{
              fontFamily: "'Montserrat', system-ui, sans-serif",
              fontSize: '0.5625rem',
              fontWeight: 300,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#4a4540',
              lineHeight: 1.8,
              marginBottom: '1.5rem',
              marginTop: '1rem'
            }}>
              Luxury Wedding Photography<br />& Cinematic Films
            </p>
            <p style={{
              fontFamily: "'Montserrat', system-ui, sans-serif",
              fontSize: '0.75rem',
              fontWeight: 300,
              color: '#4a4540',
              lineHeight: 1.8,
              maxWidth: '30ch',
              margin: 0
            }}>
              Misty Visuals specialises in luxury wedding photography and cinematic wedding films across Delhi, Mumbai, Jaipur, Udaipur, and destination weddings worldwide.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <p style={{
              fontFamily: "'Montserrat', system-ui, sans-serif",
              fontSize: '0.5rem',
              fontWeight: 500,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: '#1c1a18',
              marginBottom: '1.25rem',
              margin: '0 0 1.25rem 0'
            }}>Navigate</p>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {[
                ['Misty Visuals', 'https://www.mistyvisuals.com/'],
                ['My Circle', '/'],
                ['Portfolio', 'https://www.mistyvisuals.com/stories'],
                ['Films', 'https://www.mistyvisuals.com/films'],
                ['Testimonials', 'https://www.mistyvisuals.com/#testimonials'],
                ['About', 'https://www.mistyvisuals.com/about'],
                ['Enquire', 'https://www.mistyvisuals.com/contact'],
              ].map(([label, href]) => {
                const isExternal = href.startsWith('http');
                return (
                  <a 
                    key={href} 
                    href={href} 
                    target={isExternal ? "_blank" : undefined} 
                    rel={isExternal ? "noopener noreferrer" : undefined} 
                  style={{
                    fontFamily: "'Montserrat', system-ui, sans-serif",
                    fontSize: '0.75rem',
                    fontWeight: 300,
                    letterSpacing: '0.04em',
                    color: '#4a4540',
                    textDecoration: 'none',
                    transition: 'color 0.2s ease',
                  }}
                  onMouseOver={e => (e.currentTarget.style.color = '#1c1a18')}
                  onMouseOut={e => (e.currentTarget.style.color = '#4a4540')}
                >
                  {label}
                </a>
              )})}
            </nav>
          </div>

          {/* Contact */}
          <div>
            <p style={{
              fontFamily: "'Montserrat', system-ui, sans-serif",
              fontSize: '0.5rem',
              fontWeight: 500,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: '#1c1a18',
              marginBottom: '1.25rem',
              margin: '0 0 1.25rem 0'
            }}>Contact</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <a 
                href="mailto:hello@mistyvisuals.com" 
                style={{
                  fontFamily: "'Montserrat', system-ui, sans-serif",
                  fontSize: '0.75rem',
                  fontWeight: 300,
                  letterSpacing: '0.04em',
                  color: '#4a4540',
                  textDecoration: 'none',
                  transition: 'color 0.2s ease',
                }}
                onMouseOver={e => (e.currentTarget.style.color = '#1c1a18')}
                onMouseOut={e => (e.currentTarget.style.color = '#4a4540')}
              >
                hello@mistyvisuals.com
              </a>
              <a 
                href="tel:+917560008899" 
                style={{
                  fontFamily: "'Montserrat', system-ui, sans-serif",
                  fontSize: '0.75rem',
                  fontWeight: 300,
                  letterSpacing: '0.04em',
                  color: '#4a4540',
                  textDecoration: 'none',
                  transition: 'color 0.2s ease',
                }}
                onMouseOver={e => (e.currentTarget.style.color = '#1c1a18')}
                onMouseOut={e => (e.currentTarget.style.color = '#4a4540')}
              >
                +91 7560008899
              </a>
              <span style={{
                fontFamily: "'Montserrat', system-ui, sans-serif",
                fontSize: '0.75rem',
                fontWeight: 300,
                letterSpacing: '0.04em',
                color: '#4a4540',
                cursor: 'default'
              }}>Delhi, India</span>
              <span style={{
                fontFamily: "'Montserrat', system-ui, sans-serif",
                fontSize: '0.75rem',
                fontWeight: 300,
                letterSpacing: '0.04em',
                color: '#4a4540',
                cursor: 'default'
              }}>Available Worldwide</span>
            </div>
          </div>

          {/* Social */}
          <div>
            <p style={{
              fontFamily: "'Montserrat', system-ui, sans-serif",
              fontSize: '0.5rem',
              fontWeight: 500,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: '#1c1a18',
              marginBottom: '1.25rem',
              margin: '0 0 1.25rem 0'
            }}>Follow</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <a 
                href="https://www.instagram.com/weddingsbymistyvisuals" 
                target="_blank" 
                rel="noopener noreferrer" 
                style={{
                  fontFamily: "'Montserrat', system-ui, sans-serif",
                  fontSize: '0.75rem',
                  fontWeight: 300,
                  letterSpacing: '0.04em',
                  color: '#4a4540',
                  textDecoration: 'none',
                  transition: 'color 0.2s ease',
                }}
                onMouseOver={e => (e.currentTarget.style.color = '#1c1a18')}
                onMouseOut={e => (e.currentTarget.style.color = '#4a4540')}
              >
                Instagram
              </a>
              <a 
                href="https://www.youtube.com/@weddingsbymistyvisuals" 
                target="_blank" 
                rel="noopener noreferrer" 
                style={{
                  fontFamily: "'Montserrat', system-ui, sans-serif",
                  fontSize: '0.75rem',
                  fontWeight: 300,
                  letterSpacing: '0.04em',
                  color: '#4a4540',
                  textDecoration: 'none',
                  transition: 'color 0.2s ease',
                }}
                onMouseOver={e => (e.currentTarget.style.color = '#1c1a18')}
                onMouseOut={e => (e.currentTarget.style.color = '#4a4540')}
              >
                YouTube
              </a>
            </div>
          </div>
        </div>

        {/* ── Bottom bar ── */}
        <div style={{
          borderTop: '1px solid #ddd8d0',
          paddingTop: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}>
          <span style={{
            fontFamily: "'Montserrat', system-ui, sans-serif",
            fontSize: '0.5rem',
            fontWeight: 300,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#4a4540',
          }}>© 2019 Misty Visuals. All rights reserved.</span>
          <span style={{
            fontFamily: "'Montserrat', system-ui, sans-serif",
            fontSize: '0.5rem',
            fontWeight: 300,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#4a4540',
          }}>Photography & Films · India & Worldwide</span>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media (max-width: 768px) {
          .footer-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 480px) {
          .footer-grid { grid-template-columns: 1fr !important; }
        }
      ` }} />
    </footer>
  )
}
