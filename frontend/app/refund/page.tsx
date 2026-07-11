'use client'

import Link from 'next/link'

export default function RefundPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans selection:bg-neutral-100 selection:text-neutral-900">
      <div className="max-w-3xl mx-auto px-6 py-20 md:py-32">
        <a href="/login" className="text-xs uppercase tracking-[0.2em] text-neutral-400 hover:text-neutral-900 transition-colors mb-12 inline-block italic">
          ← Back to Login
        </a>
        
        <header className="mb-16">
          <h1 className="text-3xl md:text-5xl font-light tracking-tight mb-4">Refund & Cancellation</h1>
          <p className="text-neutral-500 italic">Last updated: April 09, 2026</p>
        </header>

        <section className="space-y-12 text-[15px] leading-relaxed text-neutral-700">
          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">1. Cancellation by Client</h2>
            <p className="mb-4">
              We understand that event plans can change. Our cancellation policy for photography and videography bookings is as follows:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Advance Payments:</strong> Booking advances are non-refundable as they represent the cost of blocking our dates and turning away other potential clients.</li>
              <li><strong>Cancellation within 30 days of Event:</strong> 50% of the total contract value will be applicable.</li>
              <li><strong>Cancellation within 7 days of Event:</strong> 100% of the total contract value will be applicable.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">2. Postponement</h2>
            <p>
              In the event of a postponement, your advance payment will be transferred to the newly agreed-upon date in our availability, provided we receive formal notification at least two (2) months prior to the initially scheduled event. Please note that any package discounts or promotional offers applied to the original booking will become nullified, and the updated date will be subject to our current standard pricing.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">3. Refunds</h2>
            <p>
              Refunds (if applicable) will be processed to the original payment method within 7-10 working days of the approved cancellation.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">4. Shipping & Delivery</h2>
            <p>
              Digital deliverables (edited photographs and films) are delivered via online secure galleries within the timelines specified in your contract, incurring no physical shipping costs. For physical deliverables such as printed photobooks or premium albums, clients have the option to either collect them directly from our studio office at no charge, or opt for home delivery. If home delivery is chosen, all applicable shipping and courier charges will be borne by the client.
            </p>
          </div>

          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-neutral-900 mb-4">5. Dissatisfaction</h2>
            <p>
              While we strive for artistic excellence, photography is subjective. No refunds will be issued once the service has been performed and media has been delivered.
            </p>
          </div>
        </section>

        
      </div>
    </div>
  )
}
