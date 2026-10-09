import { PrismaClient } from '@prisma/client';
import { generateNextCustomerId, generateNextWorkerId, generateNextTransactionId } from './idGenerator';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Auto-generate customId in DB for CustomerProfile, WorkerProfile, and Transaction upon creation
prisma.$use(async (params, next) => {
  if (params.action === 'create') {
    if (params.model === 'CustomerProfile') {
      if (!params.args.data?.customId) {
        params.args.data = params.args.data || {};
        params.args.data.customId = await generateNextCustomerId(prisma);
      }
    } else if (params.model === 'WorkerProfile') {
      if (!params.args.data?.customId) {
        params.args.data = params.args.data || {};
        params.args.data.customId = await generateNextWorkerId(prisma, params.args.data.fullName);
      }
    } else if (params.model === 'Transaction') {
      if (!params.args.data?.customId) {
        params.args.data = params.args.data || {};
        params.args.data.customId = await generateNextTransactionId(prisma);
      }
    }
  }

  // Handle nested create inside User.create
  if (params.action === 'create' && params.model === 'User' && params.args.data) {
    if (params.args.data.customerProfile?.create && !params.args.data.customerProfile.create.customId) {
      params.args.data.customerProfile.create.customId = await generateNextCustomerId(prisma);
    }
    if (params.args.data.workerProfile?.create && !params.args.data.workerProfile.create.customId) {
      const name = params.args.data.workerProfile.create.fullName;
      params.args.data.workerProfile.create.customId = await generateNextWorkerId(prisma, name);
    }
  }

  return next(params);
});

export default prisma;
