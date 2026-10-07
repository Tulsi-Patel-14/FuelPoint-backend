import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function generateQR() {
  try {
    // 1. Get or create a customer
    let customer = await prisma.user.findFirst({
      where: { role: 'CUSTOMER' },
      include: { customerProfile: true }
    });

    if (!customer) {
      console.log('No customer found. Creating a test customer...');
      customer = await prisma.user.create({
        data: {
          mobile: '9999999999',
          role: 'CUSTOMER',
          customerProfile: {
            create: {
              fullName: 'Test Customer'
            }
          }
        },
        include: { customerProfile: true }
      });
    }

    const profileId = customer.customerProfile?.id;
    if (!profileId) throw new Error('Customer has no profile.');

    // 2. Generate a token
    const token = crypto.randomBytes(16).toString('hex');
    // Set expiration to 1 hour for testing
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    // 3. Create QRSession
    const qrSession = await prisma.qRSession.create({
      data: {
        token,
        customerId: profileId,
        expiresAt,
        status: 'ACTIVE'
      }
    });

    const qrValue = `fuel://customer/${qrSession.token}`;

    console.log('\n=======================================');
    console.log('✅ QR Session Generated Successfully!');
    console.log('=======================================');
    console.log(`\nCopy and paste this string into the Worker App (if it has a text input for scanning):`);
    console.log(`\n  ${qrValue}\n`);
    
    console.log('This QR token is valid for 1 hour.');

  } catch (error) {
    console.error('Error generating QR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

generateQR();
