import { Metadata } from 'next'
import GalleryClient from './GalleryClient'

type Props = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  
  const apiUrls = [
    process.env.NEXT_PUBLIC_API_URL,
    'https://mycircle.mistyvisuals.com',
    'https://os.mistyvisuals.com',
    'http://localhost:3004'
  ].filter(Boolean) as string[]

  let event: any = null

  for (const baseUrl of apiUrls) {
    try {
      const res = await fetch(`${baseUrl}/api/gallery/public/events/${slug}`, {
        next: { revalidate: 60 } // Cache for 60 seconds
      })
      if (res.ok) {
        event = await res.json()
        break
      }
    } catch (e) {
      // Try next fallback
    }
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
    twitter: {
      card: 'summary_large_image',
      title,
      description: desc,
      images: [imageUrl],
    }
  }
}

export default async function GalleryPage({ params }: Props) {
  const { slug } = await params
  return <GalleryClient slug={slug} />
}
