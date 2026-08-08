'use client'

import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans selection:bg-neutral-100 selection:text-neutral-900">
      <div className="max-w-3xl mx-auto px-6 py-20 md:py-32">
        <header className="mb-16">
          <h1 className="text-3xl md:text-5xl font-light tracking-tight mb-4">Privacy Policy</h1>
          <p className="text-neutral-500 italic">Last updated: August 03, 2026</p>
        </header>

        <section className="space-y-12 text-[15px] leading-relaxed text-neutral-700">
          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">1. Introduction</h2>
            <p>
              Misty Visuals My Circle is handled by Misty Visuals Pvt Ltd and is committed to protecting the privacy and security of your personal information. 
              This policy describes how we collect, use, and secure your data, particularly your verification selfie, when you use our guest photo delivery services.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">2. Information We Collect</h2>
            <p className="mb-4">We collect information directly from you when you log in and register your profile:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Profile Details:</strong> Name, email address, and phone number to authenticate your identity and deliver event match notifications.</li>
              <li><strong>Facial Recognition Data (Selfies):</strong> A close-up selfie captured using your device's camera to enable AI face matching in event galleries.</li>
              <li><strong>Device Media Storage:</strong> When you choose to download or save high-resolution photos from event galleries to your device, our app requests permission to write images to your local photo library. We do not scan, read, or upload any private photos from your device's photo gallery.</li>
              <li><strong>Usage logs:</strong> Technical information including IP addresses, login timestamps, and event interactions for security and system improvements.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">3. Face Data & AI Processing Policy</h2>
            <p className="mb-4">We handle your face data with strict privacy, security, and technical safeguards:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Data Collected:</strong> Live selfie photographs and mathematical facial embeddings generated during face registration.</li>
              <li><strong>In-House Server Processing:</strong> All facial recognition processing, feature extraction, and AI vector generation are conducted entirely on our secure in-house servers. No facial data is transmitted to third-party AI companies or external AI processing providers.</li>
              <li><strong>Storage:</strong> Images and facial embeddings are encrypted in transit and stored securely in Cloudflare R2 storage infrastructure.</li>
              <li><strong>Purpose & Photo Matching:</strong> Face data is used strictly for identifying and displaying your photos within your registered event galleries. Face data is never sold, shared with advertisers, or used for cross-app tracking.</li>
              <li><strong>Data Retention & Deletion:</strong> Face data and corresponding embeddings are retained only for the duration of the active event circle (or until user account deletion), after which they are permanently deleted. You can also delete your selfie at any time directly through the "My Profile" tab in your account dashboard.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">4. Security Measures</h2>
            <p>
              We implement industry-standard encryption, SSL transmission, and secure token-based authentication (JWT) to safeguard your profile, facial embeddings, and media access.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">5. Support</h2>
            <p>
              If you have any questions about your data or would like to request manual deletion, please contact us at: <br />
              <strong>Email:</strong> contact@mistyvisuals.com
            </p>
          </div>
        </section>

        
      </div>
    </div>
  )
}
