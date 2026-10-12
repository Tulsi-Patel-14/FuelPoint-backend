import { PrismaClient } from '@prisma/client';

export const formatCustomerId = (seq: number): string => {
  const padded = String(seq).padStart(3, '0');
  return `cust${padded}`;
};

export const formatWorkerId = (fullName: string | null | undefined, seq: number): string => {
  const padded = String(seq).padStart(3, '0');
  if (!fullName || !fullName.trim()) {
    return `WRK${padded}`;
  }
  const cleanFirstName = fullName.trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '');
  const capitalized = cleanFirstName
    ? cleanFirstName.charAt(0).toUpperCase() + cleanFirstName.slice(1)
    : 'Worker';
  return `${capitalized}${padded}`;
};

export const formatTransactionId = (seq: number): string => {
  const padded = String(seq).padStart(5, '0');
  return `TXN${padded}`;
};

export const generateNextCustomerId = async (prisma: PrismaClient): Promise<string> => {
  try {
    const result: any = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(MAX(CAST(SUBSTRING("customId" FROM 5) AS INTEGER)), 0) as max_seq 
      FROM "CustomerProfile" 
      WHERE "customId" LIKE 'cust%'
    `);
    const maxSeq = result?.[0]?.max_seq ? Number(result[0].max_seq) : 0;
    const countResult: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "CustomerProfile"`);
    const count = countResult?.[0]?.count ? Number(countResult[0].count) : 0;
    const nextSeq = Math.max(maxSeq + 1, count + 1);
    
    let candidate = formatCustomerId(nextSeq);
    let attempts = 0;
    while (attempts < 20) {
      const exists = await prisma.customerProfile.findFirst({ where: { customId: candidate } });
      if (!exists) return candidate;
      attempts++;
      candidate = formatCustomerId(nextSeq + attempts);
    }
    return candidate;
  } catch (error) {
    console.error('Error generating customer customId:', error);
    return `cust${(Date.now() % 1000).toString().padStart(3, '0')}`;
  }
};

export const generateNextWorkerId = async (prisma: PrismaClient, fullName?: string): Promise<string> => {
  try {
    const countResult: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "WorkerProfile"`);
    const count = countResult?.[0]?.count ? Number(countResult[0].count) : 0;
    let nextSeq = count + 1;
    
    let candidate = formatWorkerId(fullName, nextSeq);
    let attempts = 0;
    while (attempts < 20) {
      const exists = await prisma.workerProfile.findFirst({ where: { customId: candidate } });
      if (!exists) return candidate;
      attempts++;
      candidate = formatWorkerId(fullName, nextSeq + attempts);
    }
    return candidate;
  } catch (error) {
    console.error('Error generating worker customId:', error);
    return formatWorkerId(fullName, Date.now() % 1000);
  }
};

export const generateNextTransactionId = async (prisma: PrismaClient): Promise<string> => {
  try {
    const result: any = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(MAX(CAST(SUBSTRING("customId" FROM 4) AS INTEGER)), 0) as max_seq 
      FROM "Transaction" 
      WHERE "customId" LIKE 'TXN%'
    `);
    const maxSeq = result?.[0]?.max_seq ? Number(result[0].max_seq) : 0;
    const countResult: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "Transaction"`);
    const count = countResult?.[0]?.count ? Number(countResult[0].count) : 0;
    const nextSeq = Math.max(maxSeq + 1, count + 1);
    
    let candidate = formatTransactionId(nextSeq);
    let attempts = 0;
    while (attempts < 20) {
      const exists = await prisma.transaction.findFirst({ where: { customId: candidate } });
      if (!exists) return candidate;
      attempts++;
      candidate = formatTransactionId(nextSeq + attempts);
    }
    return candidate;
  } catch (error) {
    console.error('Error generating transaction customId:', error);
    return `TXN${(Date.now() % 100000).toString().padStart(5, '0')}`;
  }
};

export const backfillCustomIds = async (prisma: PrismaClient): Promise<void> => {
  try {
    // 1. Backfill Customers
    await prisma.$executeRawUnsafe(`
      UPDATE "CustomerProfile" 
      SET "customId" = 'cust' || LPAD(sub.seq::text, 3, '0')
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY "joinedAt" ASC) as seq 
        FROM "CustomerProfile" 
        WHERE "customId" IS NULL
      ) sub
      WHERE "CustomerProfile".id = sub.id
    `);

    // 2. Backfill Workers
    await prisma.$executeRawUnsafe(`
      UPDATE "WorkerProfile"
      SET "customId" = CASE 
        WHEN "fullName" IS NOT NULL AND length(trim("fullName")) > 0 THEN 
          INITCAP(REGEXP_REPLACE(SPLIT_PART(trim("fullName"), ' ', 1), '[^a-zA-Z0-9]', '', 'g')) || LPAD(sub.seq::text, 3, '0')
        ELSE 
          'WRK' || LPAD(sub.seq::text, 3, '0')
      END
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY "joinedAt" ASC) as seq 
        FROM "WorkerProfile" 
        WHERE "customId" IS NULL
      ) sub
      WHERE "WorkerProfile".id = sub.id
    `);

    // 3. Backfill Transactions
    await prisma.$executeRawUnsafe(`
      UPDATE "Transaction"
      SET "customId" = 'TXN' || LPAD(sub.seq::text, 5, '0')
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC) as seq 
        FROM "Transaction" 
        WHERE "customId" IS NULL
      ) sub
      WHERE "Transaction".id = sub.id
    `);

    console.log('[idGenerator] Raw SQL Backfill completed successfully.');
  } catch (error) {
    console.error('[idGenerator] Error backfilling custom IDs with SQL:', error);
  }
};
