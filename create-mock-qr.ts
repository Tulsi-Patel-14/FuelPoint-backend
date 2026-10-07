import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createMockQR() {
  try {
    let customer = await prisma.customerProfile.findFirst();
    
    if (!customer) {
      console.log('No customers found. Creating a mock customer...');
      // Create user first
      const user = await prisma.user.create({
        data: {
          mobile: '9999999999',
          password: 'mockpassword',
          role: 'CUSTOMER'
        }
      });
      // Create customer profile
      customer = await prisma.customerProfile.create({
        data: {
          userId: user.id,
          fullName: 'Test Customer',
          vehicle: 'MH-12-AB-1234'
        }
      });
    }

    const token = 'test-mock-qr-token-999';
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.qRSession.deleteMany({ where: { token } });

    await prisma.qRSession.create({
      data: {
        token,
        customerId: customer.id,
        expiresAt,
        status: 'ACTIVE'
      }
    });

    console.log('SUCCESS');
    console.log(`Customer: ${customer.fullName}`);
    console.log(`Token String: fuel://customer/${token}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createMockQR();
