import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(req: NextRequest) {
  // On mycircle, everything served by Next.js is public.
  // No redirects or admin tokens needed on the frontend.
  return NextResponse.next()
}
