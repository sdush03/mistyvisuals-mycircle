import { NextResponse } from 'next/server'

export const dynamic = 'force-static'

export async function GET() {
  const aasa = {
    applinks: {
      apps: [],
      details: [
        {
          appID: '9S743W7CRJ.com.mistyvisuals.mycircle',
          paths: ['/*', '/api/gallery/*']
        }
      ]
    },
    webcredentials: {
      apps: ['9S743W7CRJ.com.mistyvisuals.mycircle']
    }
  }

  return new NextResponse(JSON.stringify(aasa, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
    }
  })
}
