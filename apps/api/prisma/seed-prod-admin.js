const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

const prisma = new PrismaClient();

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to initialize the production admin.`);
  }
  return value;
}

async function main() {
  const email = readRequiredEnv('PROD_ADMIN_EMAIL');
  const password = readRequiredEnv('PROD_ADMIN_PASSWORD');

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      role: true,
      isActive: true,
    },
  });

  if (existingUser) {
    if (existingUser.role !== 'ADMIN' || !existingUser.isActive) {
      throw new Error(
        'A user with PROD_ADMIN_EMAIL already exists but is not an active ADMIN. No changes were made.',
      );
    }

    console.log('Production admin already exists. No changes were made.');
    return;
  }

  const passwordHash = await argon2.hash(password);

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: 'Production Admin',
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log('Production admin created successfully.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Production admin initialization failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
