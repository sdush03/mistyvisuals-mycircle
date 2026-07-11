'use client'

import Link from 'next/link'

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-white/10 selection:text-white relative overflow-hidden">
      {/* Overlays from first slide */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 60% 35%, rgba(160,80,20,0.18) 0%, transparent 65%)' }} />

      <div className="relative z-10 max-w-3xl mx-auto px-6 py-20 md:py-32">
        <a href="/login" className="text-xs uppercase tracking-[0.2em] text-white/40 hover:text-white transition-colors mb-12 inline-block italic">
          ← Back to Login
        </a>
        
        <header className="mb-16">
          <h1 className="text-3xl md:text-5xl font-light tracking-tight mb-4 drop-shadow-lg">Contact Us</h1>
          <p className="text-white/50 italic">We are here to help you.</p>
        </header>

        <section className="space-y-12 text-[15px] leading-relaxed text-white/70">
          <div>
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-white mb-4">Get in Touch</h2>
            <p className="mb-8">
              For any support regarding the Studio OS, payment issues, or booking inquiries, please reach out to us via any of the following channels:
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-xs uppercase tracking-[0.1em] text-white/40 mb-2">Email</h3>
                <p className="text-white font-medium">contact@mistyvisuals.com</p>
              </div>
              <div className="md:col-span-2">
                <h3 className="text-xs uppercase tracking-[0.1em] text-white/40 mb-2">Address</h3>
                <p className="text-white font-medium leading-relaxed">
                  HN 415, Sector 40<br />
                  Gurgaon, Haryana, 122001<br />
                  India
                </p>
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-white/10">
            <h2 className="text-sm uppercase tracking-[0.1em] font-bold text-white mb-4">Grievance Officer</h2>
            <p className="text-white/60">
              In accordance with the Information Technology Act 2000, the name and contact details of the Grievance Officer are provided below:
            </p>
            <p className="mt-4 text-white font-medium">
              Mr. Dushyant Saini<br />
              Email: contact@mistyvisuals.com
            </p>
          </div>
        </section>

        
      </div>
    </div>
  )
}
