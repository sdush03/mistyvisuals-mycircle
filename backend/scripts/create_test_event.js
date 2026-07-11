const { prisma } = require('../modules/quotation/prisma');

async function run() {
  console.log('Inserting mock wedding gallery event...');
  try {
    // Delete existing test event if it exists to keep it idempotent
    const existing = await prisma.galleryEvent.findFirst({
      where: { slug: 'arjun-priya' }
    });
    if (existing) {
      await prisma.galleryEvent.delete({ where: { id: existing.id } });
      console.log('Deleted existing test event.');
    }

    const event = await prisma.galleryEvent.create({
      data: {
        id: 1, // Explicitly set ID = 1 so uploader POC matches
        slug: 'arjun-priya',
        title: "Arjun & Priya's Wedding",
        date: new Date('2026-11-20'),
        qrToken: 'arjun_priya_token',
        coverPhotoUrl: 'https://images.unsplash.com/photo-1519741497674-611481863552?q=80&w=1200'
      }
    });

    console.log('Successfully created test event:', event);
  } catch (err) {
    console.error('Error creating test event:', err);
  } finally {
    process.exit(0);
  }
}

run();
