import { Metadata } from 'next'
import GalleryClient from './GalleryClient'

type Props = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  
  const baseUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3004'
  let event: any = null

  try {
    const res = await fetch(`${baseUrl}/api/gallery/public/events/${slug}`, {
      next: { revalidate: 60 } // Cache for 60 seconds
    })
    if (res.ok) {
      event = await res.json()
    }
  } catch (e) {
    // Event not found or network error, use default metadata
  }

  const title = event?.title || 'Misty Visuals Gallery'
  const desc = event?.title 
    ? `View the wedding gallery for ${event.title}.` 
    : 'View the wedding gallery on Misty Visuals My Circle.'

  let imageUrl = event?.coverPhotoUrl || ''
  if (imageUrl && imageUrl.startsWith('/')) {
    imageUrl = `https://mycircle.mistyvisuals.com${imageUrl}`
  } else if (!imageUrl) {
    imageUrl = 'https://mycircle.mistyvisuals.com/logo-white.png'
  }

  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: title,
        }
      ],
      type: 'website',
    },
    other: {
      'apple-itunes-app': `app-id=6796633077, app-argument=https://mycircle.mistyvisuals.com/${slug}/gallery`,
    },
  }
}

export default async function GalleryPage({ params }: Props) {
  const { slug } = await params
  return <GalleryClient slug={slug} />
}
