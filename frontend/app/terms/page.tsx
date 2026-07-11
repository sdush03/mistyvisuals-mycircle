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
              By accessing or using Misty Visuals Studio OS, you agree to be bound by these Terms and Conditions. 
              These terms govern the use of our services, including lead management, payment processing, and digital content delivery.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">2. Service Description</h2>
            <p>
              Misty Visuals provides professional photography and videography services. Our platform allows clients to view proposals, make advances, and track event progress.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">3. Payment Terms</h2>
            <p className="mb-2">Payments are processed for booking advances, milestone payments, and final balances.</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Bookings are only confirmed upon receipt of the advance payment as specified in the proposal.</li>
              <li>GST and other taxes are applicable as per Indian government regulations.</li>
              <li>Final payment is due before the delivery of final edited media.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">4. Usage Restrictions</h2>
            <p>
              Unauthorized access to the Studio OS admin panels or tampering with backend systems is strictly prohibited and may result in legal action.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">5. Intellectual Property</h2>
            <p>
              All assets, designs, and code within Studio OS are the property of Misty Visuals. All photography deliverables are subject to the copyright terms outlined in your specific service contract.
            </p>
          </div>
        </section>

        
      </div>
    </div>
  )
}
