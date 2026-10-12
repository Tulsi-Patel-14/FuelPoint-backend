import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@fuelpoint.in';
  const plainPassword = 'Admin@123';
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  // Check if admin@fuelpoint.in exists
  const existingUser = await prisma.user.findUnique({
    where: { email: adminEmail },
    include: { adminProfile: true }
  });

  let adminUser;
  if (existingUser) {
    adminUser = await prisma.user.update({
      where: { email: adminEmail },
      data: {
        password: hashedPassword,
        role: 'ADMIN',
        status: 'ACTIVE',
        adminProfile: existingUser.adminProfile
          ? {
              update: {
                fullName: 'System Admin',
                location: 'Headquarters'
              }
            }
          : {
              create: {
                fullName: 'System Admin',
                location: 'Headquarters'
              }
            }
      },
      include: { adminProfile: true }
    });
    console.log('Updated existing admin user:', adminUser);
  } else {
    adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        role: 'ADMIN',
        status: 'ACTIVE',
        adminProfile: {
          create: {
            fullName: 'System Admin',
            location: 'Headquarters'
          }
        }
      },
      include: { adminProfile: true }
    });
    console.log('Created new admin user:', adminUser);
  }

  // Also update Rajesh Menon's password to Admin@123 so that both accounts work
  const rajeshUser = await prisma.user.findUnique({
    where: { email: 'rajesh.menon@fuelpoint.in' }
  });
  if (rajeshUser) {
    await prisma.user.update({
      where: { email: 'rajesh.menon@fuelpoint.in' },
      data: {
        password: hashedPassword,
        status: 'ACTIVE'
      }
    });
    console.log('Updated rajesh.menon@fuelpoint.in password to Admin@123');
  }

  console.log('\n--- SUCCESS ---');
  console.log('Admin User ID (UUID):', adminUser.id);
  console.log('Admin Email / Login ID:', adminUser.email);
  console.log('Password:', plainPassword);
}

main()
  .catch((e) => {
    console.error('Error creating admin user:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

