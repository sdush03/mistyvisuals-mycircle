'use client'

import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans selection:bg-neutral-100 selection:text-neutral-900">
      <div className="max-w-3xl mx-auto px-6 py-20 md:py-32">
        <a href="/login" className="text-xs uppercase tracking-[0.2em] text-neutral-400 hover:text-neutral-900 transition-colors mb-12 inline-block italic">
          ← Back to Login
        </a>
        
        <header className="mb-16">
          <h1 className="text-3xl md:text-5xl font-light tracking-tight mb-4">Privacy Policy</h1>
          <p className="text-neutral-500 italic">Last updated: April 09, 2026</p>
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
              <li><strong>Profile Details:</strong> Name, email address, and phone number to authenticate your identity.</li>
              <li><strong>Facial Recognition Data (Selfies):</strong> A close-up selfie that you capture using your device's camera. This image is processed locally on our server to extract a unique, mathematical face representation (vector) for image recognition.</li>
              <li><strong>Usage logs:</strong> Technical information including IP addresses, login timestamps, and event interactions for security and system improvements.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">3. How We Use and Protect Your Data</h2>
            <p className="mb-4">Your information is processed with strict security and confidentiality guidelines:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Photo Matching:</strong> We compare your unique face vector against photos from the wedding/event gallery to automatically identify and display pictures you appear in.</li>
              <li><strong>Zero Sharing:</strong> Your selfie and vector data are strictly used for your own photo searches. We never share, sell, or monetize your facial profile or contact information with any third parties or advertisers.</li>
              <li><strong>Data Retention & Deletion:</strong> Your selfie and corresponding vector are stored securely. You can delete your selfie at any time directly through the "My Profile" tab in your account dashboard.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">4. Security Measures</h2>
            <p>
              We implement industry-standard encryption, SSL transmission, and secure token-based authentication (JWT) to safeguard your profile and media access.
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
