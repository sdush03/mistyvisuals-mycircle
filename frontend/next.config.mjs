const apiTarget = process.env.API_URL

/** @type {import('next').NextConfig} */
const nextConfig = {
  assetPrefix: process.env.NODE_ENV === 'production' ? 'https://mycircle.mistyvisuals.com' : undefined,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    webpackMemoryOptimizations: true,
    cpus: 1,
  },
  async redirects() {
    return [
      {
        source: '/admin/reports/:path*',
        destination: '/admin/finance/summaries/:path*',
        permanent: true,
      },
    ]
  },
  async rewrites() {
    if (!apiTarget) return []
    return [
      {
        source: '/api/:path*',
        destination: `${apiTarget}/api/:path*`,
      },
    ]
  },
}

import withPWAInit from '@ducanh2912/next-pwa'

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      {
        // Never serve /api/ routes from SW cache — always go to network
        urlPattern: /^https?:\/\/.*\/api\/.*/i,
        handler: 'NetworkOnly',
      },
      {
        // Bypass service worker cache for document navigations (HTML pages)
        // to prevent ERR_FAILED on redirects/session state changes
        urlPattern: ({ request }) => request.mode === 'navigate',
        handler: 'NetworkOnly',
      },
    ],
  },
})

export default withPWA(nextConfig)
