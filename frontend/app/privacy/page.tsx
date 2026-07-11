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
              Misty Visuals Operating System ("Studio OS") is committed to protecting the privacy and security of your personal information. 
              This policy describes how we collect, use, and share information when you use our internal management tools and client-facing interfaces.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">2. Information We Collect</h2>
            <p className="mb-4">We collect information directly from you when you use our services:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Personal Data:</strong> Name, email address, phone numbers, and wedding/event details provided during lead generation.</li>
              <li><strong>Billing Information:</strong> Payment details processed securely through our partners (e.g., Razorpay). We do not store your credit card numbers on our servers.</li>
              <li><strong>Usage Data:</strong> Log data including IP addresses, browser types, and interaction logs for internal auditing and security.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">3. How We Use Information</h2>
            <p>
              We use the collected data to manage leads, generate proposals, process payments, and provide photography/videography services. 
              Information is strictly used for the fulfillment of contracts and improving our internal studio operations.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">4. Data Security</h2>
            <p>
              We implement industry-standard security measures, including SSL encryption and token-based authentication, to protect your data. 
              Access to information is strictly restricted to authorized sales and administrative personnel.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">5. Contact</h2>
            <p>
              For any questions regarding this policy, please contact us at: <br />
              <strong>Email:</strong> contact@mistyvisuals.com
            </p>
          </div>
        </section>

        
      </div>
    </div>
  )
}
