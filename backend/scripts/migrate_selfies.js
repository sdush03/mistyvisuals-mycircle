const fs = require('fs');
const path = require('path');
const { prisma } = require('../prisma');

async function run() {
  const selfiesDir = path.join(__dirname, '..', 'uploads', 'photos', 'selfies');
  if (!fs.existsSync(selfiesDir)) {
    console.log('Selfies directory does not exist.');
    return;
  }

  const files = fs.readdirSync(selfiesDir);
  console.log(`Scanning ${files.length} files in selfies directory...`);

  for (const file of files) {
    if (file.startsWith('guest_') && file.endsWith('.jpg')) {
      const guestIdStr = file.replace('guest_', '').replace('.jpg', '');
      const guestId = parseInt(guestIdStr, 10);
      if (isNaN(guestId)) continue;

      try {
        // Find guest in db
        const guest = await prisma.guest.findUnique({
          where: { id: guestId }
        });

        if (!guest || !guest.email) {
          console.log(`[Warning] No guest or email found for guest ID: ${guestId}`);
          continue;
        }

        // Find circle user with that email
        const user = await prisma.circleUser.findUnique({
          where: { email: guest.email }
        });

        if (!user) {
          console.log(`[Warning] No global CircleUser found for email: ${guest.email} (Guest ID: ${guestId})`);
          continue;
        }

        const newJpgFile = `user_${user.id}.jpg`;
        const newJsonFile = `user_${user.id}.json`;
        const oldJsonFile = `guest_${guestId}.json`;

        const oldJpgPath = path.join(selfiesDir, file);
        const oldJsonPath = path.join(selfiesDir, oldJsonFile);
        
        const newJpgPath = path.join(selfiesDir, newJpgFile);
        const newJsonPath = path.join(selfiesDir, newJsonFile);

        // Copy jpg if target doesn't exist
        if (!fs.existsSync(newJpgPath)) {
          fs.copyFileSync(oldJpgPath, newJpgPath);
          console.log(`[Migrated] Copied ${file} -> ${newJpgFile} (Email: ${guest.email})`);
        } else {
          console.log(`[Skip] Target ${newJpgFile} already exists (Email: ${guest.email})`);
        }

        // Copy json vector if target doesn't exist and source exists
        if (fs.existsSync(oldJsonPath)) {
          if (!fs.existsSync(newJsonPath)) {
            fs.copyFileSync(oldJsonPath, newJsonPath);
            console.log(`[Migrated] Copied vector JSON ${oldJsonFile} -> ${newJsonFile}`);
          }
        }
      } catch (err) {
        console.error(`Error migrating guest ID ${guestId}:`, err);
      }
    }
  }

  console.log('Migration complete.');
}

run()
  .catch(err => {
    console.error('Migration crashed:', err);
  })
  .finally(() => {
    prisma.$disconnect();
  });
