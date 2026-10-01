import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('worker123', 10);
  const adminHash = await bcrypt.hash('admin123', 10);

  const defaultGroup = await prisma.group.upsert({
    where: { id: 'default-group' },
    update: {},
    create: {
      id: 'default-group',
      name: 'Standard Customer',
      discountPercent: 2,
      isDefault: true
    }
  });

  const station = await prisma.station.upsert({
    where: { id: 'test-station' },
    update: {},
    create: {
      id: 'test-station',
      name: 'Nayara Main Station',
      latitude: 19.0760,
      longitude: 72.8777
    }
  });

  await prisma.user.upsert({
    where: { email: 'rajesh.menon@fuelpoint.in' },
    update: {},
    create: {
      email: 'rajesh.menon@fuelpoint.in',
      password: adminHash,
      role: 'ADMIN',
      adminProfile: {
        create: {
          fullName: 'Rajesh Menon'
        }
      }
    }
  });

  await prisma.user.upsert({
    where: { mobile: '9123456789' },
    update: {},
    create: {
      mobile: '9123456789',
      password: hash,
      role: 'WORKER',
      workerProfile: {
        create: {
          fullName: 'Test Worker',
          stationId: station.id
        }
      }
    }
  });
}

main().then(() => console.log('Seeded')).catch(console.error);

