import { NextResponse } from 'next/server'

export const dynamic = 'force-static'

export async function GET() {
  const assetlinks = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.mistyvisuals.mycircle',
        sha256_cert_fingerprints: [
          '40:72:2F:AE:04:44:EC:5D:32:EC:A1:77:29:41:F0:6C:52:60:CB:AB:49:A3:AD:DB:36:8B:CE:DC:84:D1:7D:C8'
        ]
      }
    }
  ]

  return new NextResponse(JSON.stringify(assetlinks, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
    }
  })
}
