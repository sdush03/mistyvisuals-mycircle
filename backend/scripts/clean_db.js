const { prisma } = require('../modules/quotation/prisma');
const fs = require('fs');
const path = require('path');

async function run() {
  console.log('Cleaning up database and vector cache...');
  try {
    // Delete all photos
    const deletedPhotos = await prisma.photo.deleteMany({});
    console.log(`Deleted ${deletedPhotos.count} photos from PostgreSQL.`);

    // Delete all guests
    const deletedGuests = await prisma.guest.deleteMany({});
    console.log(`Deleted ${deletedGuests.count} guests from PostgreSQL.`);

    // Clear vector cache
    const mockDbPath = path.join(__dirname, '..', 'db', 'mock_vectors.json');
    if (fs.existsSync(mockDbPath)) {
      fs.writeFileSync(mockDbPath, '[]', 'utf8');
      console.log('Cleared mock vectors JSON file.');
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  } finally {
    process.exit(0);
  }
}

run();
