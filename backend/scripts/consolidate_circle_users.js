const { prisma } = require('../prisma');

async function consolidateCircleUsers() {
  console.log('[Consolidate] Starting CircleUser identity consolidation...');

  // Step 1: Find all guests in PostgreSQL
  const guests = await prisma.guest.findMany({
    include: { circleUser: true }
  });

  console.log(`[Consolidate] Total Guest records found: ${guests.length}`);

  let createdUserCount = 0;
  let updatedVectorCount = 0;

  for (const g of guests) {
    let circleUser = g.circleUser;

    // Create CircleUser if it doesn't exist for this guest email
    if (!circleUser && g.email) {
      try {
        circleUser = await prisma.circleUser.create({
          data: {
            email: g.email,
            name: g.name,
            phoneNumber: g.phoneNumber,
            provider: g.provider || 'google',
            providerId: g.providerId || `guest_${g.id}`,
            selfieVector: g.selfieVector || undefined,
            selfieUrl: g.selfieUrl || undefined
          }
        });
        createdUserCount++;
        console.log(`[Consolidate] Created CircleUser for email: ${g.email}`);
      } catch (err) {
        // If unique email constraint hit concurrently, fetch user
        circleUser = await prisma.circleUser.findUnique({ where: { email: g.email } });
      }
    }

    // Step 2: Migrate selfieVector to CircleUser if missing on CircleUser but present on Guest
    if (circleUser && g.selfieVector && !circleUser.selfieVector) {
      try {
        await prisma.circleUser.update({
          where: { id: circleUser.id },
          data: {
            selfieVector: g.selfieVector,
            selfieUrl: circleUser.selfieUrl || g.selfieUrl || undefined
          }
        });
        updatedVectorCount++;
        console.log(`[Consolidate] Migrated selfieVector to CircleUser ID: ${circleUser.id}`);
      } catch (err) {
        console.error(`[Consolidate] Failed vector migration for user ${circleUser.id}:`, err.message);
      }
    }
  }

  console.log(`[Consolidate] Migration Complete!`);
  console.log(`  - New CircleUsers created: ${createdUserCount}`);
  console.log(`  - Selfie vectors consolidated: ${updatedVectorCount}`);
}

if (require.main === module) {
  consolidateCircleUsers()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}

module.exports = { consolidateCircleUsers };
