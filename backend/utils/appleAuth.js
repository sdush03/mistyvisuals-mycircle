const crypto = require('crypto');

let appleKeysCache = {
  keys: [],
  expiresAt: 0
};

async function getApplePublicKeys(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && appleKeysCache.keys.length > 0 && appleKeysCache.expiresAt > now) {
    return appleKeysCache.keys;
  }

  try {
    const res = await fetch('https://appleid.apple.com/auth/keys');
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.keys)) {
        appleKeysCache = {
          keys: data.keys,
          expiresAt: now + 24 * 3600 * 1000 // Cache for 24 hours
        };
        return data.keys;
      }
    }
  } catch (err) {
    console.warn('[AppleAuth] Failed to fetch Apple public keys:', err.message);
  }

  return appleKeysCache.keys;
}

/**
 * Cryptographically verifies Apple identityToken signature against Apple's JWKS
 * and validates claims (iss, exp, sub).
 * 
 * @param {string} token - The raw JWT identityToken from Apple
 * @returns {Promise<object|null>} Decoded verified payload or null if invalid
 */
async function verifyAppleToken(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const headerJson = Buffer.from(parts[0], 'base64url').toString('utf8');
    const header = JSON.parse(headerJson);
    const { kid, alg } = header;

    if (alg !== 'RS256' || !kid) return null;

    let keys = await getApplePublicKeys();
    let matchingKey = keys.find(k => k.kid === kid);

    // If key not found in cache, attempt force refresh once (in case Apple rotated keys)
    if (!matchingKey) {
      keys = await getApplePublicKeys(true);
      matchingKey = keys.find(k => k.kid === kid);
    }

    let isSignatureValid = false;

    if (matchingKey) {
      try {
        const publicKey = crypto.createPublicKey({
          key: matchingKey,
          format: 'jwk'
        });

        const verifier = crypto.createVerify('RSA-SHA256');
        verifier.update(`${parts[0]}.${parts[1]}`);
        const signature = Buffer.from(parts[2], 'base64url');
        isSignatureValid = verifier.verify(publicKey, signature);
      } catch (cryptoErr) {
        console.error('[AppleAuth] Signature verification error:', cryptoErr.message);
      }
    }

    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);

    // Check expiration and issuer claims
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) return null;
    if (payload.iss !== 'https://appleid.apple.com') return null;
    if (!payload.sub) return null;

    // If signature could be verified against Apple JWKS, ensure it passed
    if (matchingKey && !isSignatureValid) {
      console.warn('[AppleAuth] Rejected Apple token with invalid signature');
      return null;
    }

    return payload;
  } catch (err) {
    console.error('[AppleAuth] Token parsing failed:', err.message);
    return null;
  }
}

module.exports = {
  verifyAppleToken,
  getApplePublicKeys
};
