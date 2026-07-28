// This page handles the Google OAuth popup redirect.
// Google sends the id_token in the URL hash (#) after the user selects their account.
// This page extracts the id_token from the hash and posts it to the opener (parent window).
// The parent's handleGoogleSignIn listener receives it and proceeds with authentication.

'use client'

import { useEffect } from 'react'

export default function GoogleCallbackPage() {
  useEffect(() => {
    const hash = window.location.hash.substring(1) // Remove leading '#'
    const params = new URLSearchParams(hash)
    const idToken = params.get('id_token')

    if (idToken && window.opener) {
      window.opener.postMessage(
        { type: 'google-auth', id_token: idToken },
        window.location.origin
      )
    }

    // Close the popup after posting the message
    window.close()
  }, [])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif',
      color: '#666',
      fontSize: '14px'
    }}>
      Signing you in...
    </div>
  )
}
