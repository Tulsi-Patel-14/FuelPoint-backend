import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
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
}

main().then(() => console.log('Seeded')).catch(console.error);

