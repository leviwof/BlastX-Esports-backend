// One-off script: promote a user to ADMIN (or demote back to USER).
//
// Usage:
//   node scripts/set-admin.js <email>            -> sets role = ADMIN
//   node scripts/set-admin.js <email> --demote   -> sets role = USER
//
// Connects to whatever DATABASE_URL is set in .env. Only touches the single
// user matched by the exact (lowercased) email. Idempotent + prints before/after.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const demote = process.argv.includes('--demote');
  const targetRole = demote ? 'USER' : 'ADMIN';

  if (!email) {
    console.error('Usage: node scripts/set-admin.js <email> [--demote]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`\n❌ No user found with email: ${email}`);
      console.error(
        'The person must sign in (Google or OTP) at least once so their user row exists, then re-run this.\n',
      );
      process.exit(2);
    }

    console.log(`\nFound user: ${user.id}`);
    console.log(`  email        : ${user.email}`);
    console.log(`  current role : ${user.role}`);

    if (user.role === targetRole) {
      console.log(`\n✅ Already ${targetRole}. Nothing to change.\n`);
      return;
    }

    const updated = await prisma.user.update({
      where: { email },
      data: { role: targetRole },
    });

    console.log(`\n✅ Role updated: ${user.role} -> ${updated.role} for ${updated.email}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
