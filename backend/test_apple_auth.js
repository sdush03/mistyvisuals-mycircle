/**
 * Pure unit test for Apple Sign-In user lookup logic
 * No database required — uses mock Prisma client
 * Run: node test_apple_auth.js
 */

// ── Mock data store ──────────────────────────────────────────────────────────
const db = [];
let idCounter = 1;

const prisma = {
  circleUser: {
    findFirst: async ({ where }) => {
      return db.find(u => {
        if (where.providerId && u.providerId === where.providerId) return true;
        if (where.phoneNumber && u.phoneNumber === where.phoneNumber) return true;
        return false;
      }) || null;
    },
    findUnique: async ({ where }) => {
      return db.find(u => where.email && u.email === where.email) || null;
    },
    create: async ({ data }) => {
      const user = { id: idCounter++, ...data };
      db.push(user);
      return user;
    },
    update: async ({ where, data }) => {
      const user = db.find(u => u.id === where.id);
      if (user) Object.assign(user, data);
      return user;
    },
    deleteMany: async ({ where }) => {
      const before = db.length;
      const idx = db.findIndex(u => u.email === where.email);
      if (idx !== -1) db.splice(idx, 1);
      return { count: before - db.length };
    }
  }
};

// ── The actual lookup logic (mirrors familyRoutes.js) ────────────────────────
async function simulateAppleAuth({ appleUserId, email, name }) {
  const stableId = appleUserId || null;
  const verifiedEmail = email || (stableId
    ? `apple_${stableId}@privaterelay.appleid.com`
    : `apple_${Date.now()}@privaterelay.appleid.com`);
  const verifiedName = name || 'Apple User';
  const providerId = stableId || verifiedEmail;

  let user = null;

  // Step 1: Look up by stable Apple user ID (handles returning users with null email)
  if (appleUserId) {
    user = await prisma.circleUser.findFirst({ where: { providerId: appleUserId } });
    if (user) console.log('    → Found by providerId (Apple user ID)');
  }

  // Step 2: Fall back to email lookup
  if (!user && verifiedEmail) {
    user = await prisma.circleUser.findUnique({ where: { email: verifiedEmail } });
    if (user) {
      console.log('    → Found by email');
      // Save Apple user ID for future logins
      if (appleUserId && user.providerId !== appleUserId) {
        await prisma.circleUser.update({ where: { id: user.id }, data: { providerId: appleUserId } });
        console.log('    → Updated providerId to Apple user ID for future logins');
      }
    }
  }

  // Step 3: Create if not found
  if (!user) {
    user = await prisma.circleUser.create({
      data: { email: verifiedEmail, name: verifiedName, provider: 'apple', providerId: providerId || 'global' }
    });
    console.log('    → Created new user');
  }

  return user;
}

// ── Test runner ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ PASS — ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL — ${label}`);
    failed++;
  }
}

async function main() {
  console.log('\n============================================');
  console.log(' Apple Sign-In Logic — Unit Tests (no DB)');
  console.log('============================================\n');

  const APPLE_USER_ID = 'apple_stable_001';

  // ──────────────────────────────────────────────────────────────────────────
  console.log('TEST 1: First Apple login with real email (new user, email same as Google might be)');
  const u1 = await simulateAppleAuth({ appleUserId: APPLE_USER_ID, email: 'user@icloud.com', name: 'Dushyant' });
  assert(u1 !== null, 'User created');
  assert(u1.email === 'user@icloud.com', 'Email stored correctly');
  assert(u1.providerId === APPLE_USER_ID, 'Apple user ID stored as providerId');
  console.log(`  User: id=${u1.id}, email=${u1.email}, providerId=${u1.providerId}\n`);

  // ──────────────────────────────────────────────────────────────────────────
  console.log('TEST 2: Second Apple login — email is null (Apple hides it on repeat logins)');
  const u2 = await simulateAppleAuth({ appleUserId: APPLE_USER_ID, email: null, name: null });
  assert(u2 !== null, 'User found');
  assert(u2.id === u1.id, 'Same user returned (not a duplicate!)');
  assert(u2.email === 'user@icloud.com', 'Original email preserved');
  console.log(`  User: id=${u2.id}, email=${u2.email}\n`);

  // ──────────────────────────────────────────────────────────────────────────
  console.log('TEST 3: Third Apple login — still consistent');
  const u3 = await simulateAppleAuth({ appleUserId: APPLE_USER_ID, email: null, name: null });
  assert(u3.id === u1.id, 'Same user on third login');
  console.log(`  User: id=${u3.id}\n`);

  // ──────────────────────────────────────────────────────────────────────────
  console.log('TEST 4: Existing Google user (sdush03@gmail.com) signs in with Apple using same email');
  // Simulate an existing Google user
  db.push({ id: 99, email: 'sdush03@gmail.com', name: 'Dushyant', provider: 'google', providerId: 'google_sub_xyz' });
  const APPLE_USER_ID_2 = 'apple_stable_002';
  const u4 = await simulateAppleAuth({ appleUserId: APPLE_USER_ID_2, email: 'sdush03@gmail.com', name: 'Dushyant' });
  assert(u4.id === 99, 'Found existing Google account by email — no duplicate created!');
  assert(db.find(u => u.id === 99)?.providerId === APPLE_USER_ID_2, 'ProviderId updated to Apple user ID');
  console.log(`  User: id=${u4.id}, provider stays=${u4.provider}, providerId updated=${db.find(u=>u.id===99)?.providerId}\n`);

  // ──────────────────────────────────────────────────────────────────────────
  console.log('TEST 5: That same user (was Google) now returns via Apple on second Apple login (email=null)');
  const u5 = await simulateAppleAuth({ appleUserId: APPLE_USER_ID_2, email: null, name: null });
  assert(u5.id === 99, 'Still finds original account even with email=null!');
  console.log(`  User: id=${u5.id}\n`);

  // ──────────────────────────────────────────────────────────────────────────
  console.log('TEST 6: Different Apple user (no email) — should create NEW account');
  const APPLE_USER_ID_3 = 'apple_stable_003';
  const u6 = await simulateAppleAuth({ appleUserId: APPLE_USER_ID_3, email: null, name: null });
  assert(u6.id !== u1.id && u6.id !== 99, 'New account created for different Apple user');
  assert(u6.email === `apple_${APPLE_USER_ID_3}@privaterelay.appleid.com`, 'Stable placeholder email generated');
  console.log(`  User: id=${u6.id}, email=${u6.email}\n`);

  // ──────────────────────────────────────────────────────────────────────────
  console.log('============================================');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('============================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
