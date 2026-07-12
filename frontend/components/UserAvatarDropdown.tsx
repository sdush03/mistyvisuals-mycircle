'use client'

import React, { useState, useEffect, useRef } from 'react'

interface UserAvatarDropdownProps {
  selfieUrl: string | null
  onProfileClick: () => void
  onLogoutClick: () => void
  darkTheme?: boolean
}

export function UserAvatarDropdown({
  selfieUrl,
  onProfileClick,
  onLogoutClick,
  darkTheme = false
}: UserAvatarDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const handleProfileClick = () => {
    setIsOpen(false)
    onProfileClick()
  }

  const handleLogoutClick = () => {
    setIsOpen(false)
    onLogoutClick()
  }

  // Styling configurations
  const themeStyles = {
    buttonBorder: darkTheme ? 'rgba(255, 255, 255, 0.25)' : 'rgba(28, 26, 24, 0.15)',
    buttonBg: 'transparent',
    dropdownBg: darkTheme ? 'rgba(15, 15, 15, 0.75)' : 'rgba(255, 255, 255, 0.85)',
    dropdownBorder: darkTheme ? 'rgba(255, 255, 255, 0.1)' : 'rgba(28, 26, 24, 0.08)',
    dropdownShadow: darkTheme ? '0 10px 30px rgba(0,0,0,0.5)' : '0 10px 30px rgba(0,0,0,0.06)',
    textColor: darkTheme ? '#ffffff' : '#1c1a18',
    itemHoverBg: darkTheme ? 'rgba(255, 255, 255, 0.08)' : 'rgba(28, 26, 24, 0.04)',
    dividerBg: darkTheme ? 'rgba(255, 255, 255, 0.08)' : 'rgba(28, 26, 24, 0.06)'
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: themeStyles.buttonBg,
          border: `1px solid ${themeStyles.buttonBorder}`,
          borderRadius: '50%',
          width: '36px',
          height: '36px',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          outline: 'none',
          boxSizing: 'border-box'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)'
          e.currentTarget.style.borderColor = darkTheme ? '#ffffff' : '#1c1a18'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.borderColor = themeStyles.buttonBorder
        }}
      >
        {selfieUrl ? (
          <img
            src={selfieUrl}
            alt="User Avatar"
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              objectFit: 'cover'
            }}
          />
        ) : (
          <span style={{ fontSize: '1rem', color: themeStyles.textColor }}>👤</span>
        )}
      </button>

      {/* Glassmorphic Dropdown */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '46px',
            right: 0,
            width: '150px',
            backgroundColor: themeStyles.dropdownBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: `1px solid ${themeStyles.dropdownBorder}`,
            borderRadius: '4px',
            boxShadow: themeStyles.dropdownShadow,
            padding: '4px 0',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            animation: 'fadeInScale 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            transformOrigin: 'top right',
            boxSizing: 'border-box'
          }}
        >
          {/* My Profile */}
          <button
            onClick={handleProfileClick}
            style={{
              background: 'none',
              border: 'none',
              padding: '0.75rem 1rem',
              textAlign: 'left',
              color: themeStyles.textColor,
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '0.75rem',
              fontWeight: 500,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
              width: '100%',
              boxSizing: 'border-box'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = themeStyles.itemHoverBg
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            My Profile
          </button>

          {/* Divider */}
          <div style={{ height: '1px', backgroundColor: themeStyles.dividerBg, margin: '4px 0' }} />

          {/* Sign Out */}
          <button
            onClick={handleLogoutClick}
            style={{
              background: 'none',
              border: 'none',
              padding: '0.75rem 1rem',
              textAlign: 'left',
              color: darkTheme ? '#ff6b6b' : '#dc2626',
              fontFamily: '"Montserrat", system-ui, sans-serif',
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
              width: '100%',
              boxSizing: 'border-box'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = themeStyles.itemHoverBg
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            Sign Out
          </button>
        </div>
      )}

      {/* Embedded Animation styles */}
      <style>{`
        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(-4px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
