const fs = require('fs');
const path = require('path');
const { prisma } = require('../prisma');

async function run() {
  const users = await prisma.circleUser.findMany({
    orderBy: { id: 'asc' }
  });

  const selfiesDir = path.join(__dirname, '..', 'uploads', 'photos', 'selfies');

  console.log('\n======================================================');
  console.log('                 MYCIRCLE USER & SELFIE DIRECTORY     ');
  console.log('======================================================\n');

  if (!fs.existsSync(selfiesDir)) {
    console.log(`[Error] Selfies directory does not exist at: ${selfiesDir}`);
    return;
  }

  for (const u of users) {
    const guests = await prisma.guest.findMany({
      where: { email: u.email }
    });

    const userSelfiePath = path.join(selfiesDir, `user_${u.id}.jpg`);
    const userVectorPath = path.join(selfiesDir, `user_${u.id}.json`);
    const userSelfieExists = fs.existsSync(userSelfiePath);
    const userVectorExists = fs.existsSync(userVectorPath);

    // Scan for any legacy guest-level selfies for this user's guests
    const legacySelfies = [];
    for (const g of guests) {
      const legacyPath = path.join(selfiesDir, `guest_${g.id}.jpg`);
      const legacyVector = path.join(selfiesDir, `guest_${g.id}.json`);
      if (fs.existsSync(legacyPath)) {
        legacySelfies.push({
          guestId: g.id,
          hasJpg: true,
          hasVector: fs.existsSync(legacyVector)
        });
      }
    }

    const guestList = guests.map(g => `GuestID: ${g.id} (Event: ${g.eventId})`).join(', ');
    
    console.log(`UserID: ${u.id}`);
    console.log(`  Name        : ${u.name || 'N/A'}`);
    console.log(`  Email       : ${u.email}`);
    console.log(`  Phone       : ${u.phoneNumber || 'N/A'}`);
    console.log(`  Guests      : [${guestList || 'None'}]`);
    console.log(`  User Selfie : ${userSelfieExists ? '✓ EXISTS (user_' + u.id + '.jpg)' : '✗ MISSING'}`);
    console.log(`  User Vector : ${userVectorExists ? '✓ EXISTS (user_' + u.id + '.json)' : '✗ MISSING'}`);
    
    if (legacySelfies.length > 0) {
      console.log(`  Legacy Files:`);
      legacySelfies.forEach(l => {
        console.log(`    - guest_${l.guestId}.jpg: ✓ EXISTS | Vector: ${l.hasVector ? '✓' : '✗'}`);
      });
    } else {
      console.log(`  Legacy Files: None found`);
    }
    console.log('------------------------------------------------------');
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
