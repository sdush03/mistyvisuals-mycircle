import { Metadata } from 'next'
import GalleryClient from './GalleryClient'

type Props = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://os.mistyvisuals.com'

  try {
    const res = await fetch(`${apiUrl}/api/gallery/public/events/${slug}`, {
      next: { revalidate: 60 } // Cache for 60 seconds
    })
    if (!res.ok) return {}
    const event = await res.json()

    const title = event.title || 'Misty Visuals Gallery'
    const desc = `View the wedding gallery for ${event.title || 'Misty Visuals'}.`
    const images = event.coverPhotoUrl ? [event.coverPhotoUrl] : []

    return {
      title,
      description: desc,
      openGraph: {
        title,
        description: desc,
        images,
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description: desc,
        images,
      }
    }
  } catch (e) {
    return {}
  }
}

export default async function GalleryPage({ params }: Props) {
  const { slug } = await params
  return <GalleryClient slug={slug} />
}
