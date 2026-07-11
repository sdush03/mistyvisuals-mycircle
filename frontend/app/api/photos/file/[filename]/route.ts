import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  const apiUrl = process.env.API_URL
  if (!apiUrl) {
    return new NextResponse('API_URL not configured', { status: 500 })
  }

  const resolvedParams = await context.params
  const filename = resolvedParams?.filename
  if (!filename) {
    return new NextResponse('Not found', { status: 404 })
  }

  const upstreamUrl = `${apiUrl}/api/photos/file/${encodeURIComponent(filename)}`
  const upstreamRes = await fetch(upstreamUrl)

  if (!upstreamRes.ok) {
    const errorText = await upstreamRes.text().catch(() => '')
    return new NextResponse(errorText || 'Failed to load image', { status: upstreamRes.status })
  }

  const headers = new Headers(upstreamRes.headers)
  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    headers,
  })
}
