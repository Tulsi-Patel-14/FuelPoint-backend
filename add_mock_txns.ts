import { PrismaClient, FuelType, TransactionStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function addMockData() {
  const customer = await prisma.customerProfile.findFirst({
    where: { isDeleted: false }
  });
  const worker = await prisma.workerProfile.findFirst({
    where: { isDeleted: false }
  });

  if (!customer || !worker) {
    console.log("No customer or worker found to attach transactions to.");
    return;
  }

  const now = new Date();
  
  const mockTransactions = [
    {
      customerId: customer.id,
      workerId: worker.id,
      stationId: 'test-station',
      fuelType: FuelType.Petrol,
      litres: 20,
      amount: 2000,
      discountPercent: 0,
      discountAmount: 0,
      finalAmount: 2000,
      status: TransactionStatus.COMPLETED,
      idempotencyKey: `mock-idem-${Date.now()}-1`,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 1), // 1 day ago
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 1)
    },
    {
      customerId: customer.id,
      workerId: worker.id,
      stationId: 'test-station',
      fuelType: FuelType.Diesel,
      litres: 35,
      amount: 3150,
      discountPercent: 5,
      discountAmount: 157.5,
      finalAmount: 2992.5,
      status: TransactionStatus.COMPLETED,
      idempotencyKey: `mock-idem-${Date.now()}-2`,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3), // 3 days ago
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3)
    },
    {
      customerId: customer.id,
      workerId: worker.id,
      stationId: 'test-station',
      fuelType: FuelType.Petrol,
      litres: 10,
      amount: 1000,
      discountPercent: 2,
      discountAmount: 20,
      finalAmount: 980,
      status: TransactionStatus.COMPLETED,
      idempotencyKey: `mock-idem-${Date.now()}-3`,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 5), // 5 hours ago
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 5)
    },
    {
      customerId: customer.id,
      workerId: worker.id,
      stationId: 'test-station',
      fuelType: FuelType.CNG,
      litres: 40,
      amount: 4400,
      discountPercent: 10,
      discountAmount: 440,
      finalAmount: 3960,
      status: TransactionStatus.COMPLETED,
      idempotencyKey: `mock-idem-${Date.now()}-4`,
      createdAt: new Date(now.getTime() - 1000 * 60 * 30), // 30 mins ago
      updatedAt: new Date(now.getTime() - 1000 * 60 * 30)
    },
    {
      customerId: customer.id,
      workerId: worker.id,
      stationId: 'test-station',
      fuelType: FuelType.Diesel,
      litres: 50,
      amount: 4500,
      discountPercent: 0,
      discountAmount: 0,
      finalAmount: 4500,
      status: TransactionStatus.COMPLETED,
      idempotencyKey: `mock-idem-${Date.now()}-5`,
      createdAt: new Date(), // Just now
      updatedAt: new Date()
    }
  ];

  for (const txn of mockTransactions) {
    await prisma.transaction.create({
      data: txn
    });
  }

  console.log("5 mock transactions added successfully!");
}

addMockData().catch(console.error).finally(() => prisma.$disconnect());
