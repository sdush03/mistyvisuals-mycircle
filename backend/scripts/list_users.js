const { prisma } = require('../prisma');

async function run() {
  const users = await prisma.circleUser.findMany({
    orderBy: { id: 'asc' }
  });

  console.log('\n======================================================');
  console.log('                 MYCIRCLE USER DIRECTORY              ');
  console.log('======================================================\n');

  for (const u of users) {
    const guests = await prisma.guest.findMany({
      where: { email: u.email }
    });
    const guestList = guests.map(g => `GuestID: ${g.id} (EventSlug: ${g.eventId})`).join(', ');
    console.log(`UserID: ${u.id}`);
    console.log(`  Name  : ${u.name || 'N/A'}`);
    console.log(`  Email : ${u.email}`);
    console.log(`  Phone : ${u.phoneNumber || 'N/A'}`);
    console.log(`  Guests: [${guestList || 'None'}]`);
    console.log('------------------------------------------------------');
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
