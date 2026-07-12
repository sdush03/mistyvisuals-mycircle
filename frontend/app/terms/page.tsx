'use client'

import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans selection:bg-neutral-100 selection:text-neutral-900">
      <div className="max-w-3xl mx-auto px-6 py-20 md:py-32">
        <a href="/login" className="text-xs uppercase tracking-[0.2em] text-neutral-400 hover:text-neutral-900 transition-colors mb-12 inline-block italic">
          ← Back to Login
        </a>
        
        <header className="mb-16">
          <h1 className="text-3xl md:text-5xl font-light tracking-tight mb-4">Terms & Conditions</h1>
          <p className="text-neutral-500 italic">Last updated: April 09, 2026</p>
        </header>

        <section className="space-y-12 text-[15px] leading-relaxed text-neutral-700">
          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Misty Visuals My Circle, which is handled by Misty Visuals Pvt Ltd, you agree to be bound by these Terms and Conditions. 
              These terms govern the use of our guest services, including photo matching, selfie uploads, and media downloads.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">2. Description of Service</h2>
            <p>
              Misty Visuals My Circle is a secure platform that allows wedding and event guests to view their photos. 
              By capturing a verification selfie, the platform uses AI facial recognition to search the event gallery and show only the photos you appear in.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">3. Selfie and Account Use</h2>
            <p className="mb-2">To use the facial search, you agree to the following terms:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>You must only upload a verification selfie of **yourself**. Uploading photos of other individuals without their consent is strictly prohibited.</li>
              <li>You agree to use your real name, email, and phone number to verify your identity.</li>
              <li>You retain the right to delete your verification selfie and face vector from our systems at any time.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">4. Content Ownership and Restrictions</h2>
            <p className="mb-2">All media, designs, and systems in Misty Visuals My Circle are the intellectual property of Misty Visuals Pvt Ltd or respective event organizers.</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Photos displayed are subject to copyright. You are authorized to download and share your matched photos for personal, non-commercial use only.</li>
              <li>Any attempt to reverse-engineer, exploit, or bypass the authentication systems to access private files is strictly prohibited and subject to legal action.</li>
            </ul>
          </div>
        </section>

        
      </div>
    </div>
  )
}
