import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getGroups() {
  const groups = await prisma.group.findMany();
  console.log(groups);
}

getGroups().catch(console.error).finally(() => prisma.$disconnect());
