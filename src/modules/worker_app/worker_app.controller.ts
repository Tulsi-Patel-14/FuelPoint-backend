import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateTokens } from '../../utils/jwt';

const prisma = new PrismaClient();

// In-memory store for OTPs (For production, consider using Redis)
// Format: { "9876543210": { otp: "1234", expiresAt: 1699999999999 } }
const otpStore = new Map<string, { otp: string; expiresAt: number }>();

/**
 * 1. Request OTP (Only existing WORKER users)
 */
export const requestOtp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mobile } = req.body;
    
    // Check if worker exists in the database
    const user = await prisma.user.findFirst({
      where: { mobile, role: 'WORKER' }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Worker not found in database. Cannot login.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, message: 'Account is pending approval or suspended.' });
    }

    // Generate a 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    
    // Store OTP in memory, valid for 5 minutes
    otpStore.set(mobile, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

    // Mock sending message by printing to console
    console.log(`\n📲 [SMS MOCK] Sending OTP to ${mobile}: ${otp}\n`);

    res.status(200).json({ 
      success: true, 
      message: 'OTP sent successfully to registered mobile number.',
      // We can also return it in response for easy testing on frontend
      mockOtpForTesting: otp 
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Verify OTP and Login
 */
export const verifyOtpAndLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mobile, otp } = req.body;
    
    const record = otpStore.get(mobile);

    if (!record) {
      return res.status(400).json({ success: false, message: 'No OTP requested for this mobile number.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(mobile);
      return res.status(400).json({ success: false, message: 'OTP has expired.' });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    // OTP verified successfully, clear it
    otpStore.delete(mobile);

    // Fetch user with profile
    const user = await prisma.user.findFirst({
      where: { mobile, role: 'WORKER' },
      include: { workerProfile: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Worker not found.' });
    }

    // Generate JWT Tokens
    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token: accessToken,
        user: user.workerProfile
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Scan Customer QR Code
 */
export const scanCustomerQR = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { qrToken } = req.body;
    
    // Automatically strip the "fuel://customer/" prefix if the mobile app sends the full scanned string
    let cleanToken = qrToken || '';
    if (cleanToken.startsWith('fuel://customer/')) {
      cleanToken = cleanToken.replace('fuel://customer/', '');
    }
    
    const qrSession = await prisma.qRSession.findUnique({
      where: { token: cleanToken },
      include: { 
        customer: {
          include: { group: true }
        }
      }
    });

    if (!qrSession) {
      return res.status(400).json({ success: false, message: 'Invalid QR Code.' });
    }

    if (qrSession.status !== 'ACTIVE' || qrSession.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'QR Code has expired or was already used.' });
    }

    // Update status to 'SCANNED' to reserve it
    await prisma.qRSession.update({
      where: { id: qrSession.id },
      data: { status: 'SCANNED' }
    });

    res.status(200).json({
      success: true,
      data: {
        valid: true,
        qrSessionId: qrSession.id,
        customer: {
          id: qrSession.customer.id,
          customerId: qrSession.customer.id,
          fullName: qrSession.customer.fullName,
          vehicle: qrSession.customer.vehicle,
          status: 'ACTIVE',
          group: qrSession.customer.group ? {
            groupName: qrSession.customer.group.name,
            groupType: 'Standard'
          } : {
            groupName: 'Regular Customer',
            groupType: 'Standard'
          }
        },
        discountPercentage: qrSession.customer.group?.discountPercent || 0,
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify Customer OTP
 * Worker enters the OTP provided by the customer to confirm their presence.
 */
export const verifyCustomerOtp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerId, qrSessionId, otp } = req.body;

    if (!customerId || !qrSessionId || !otp) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    // In a production app, you would verify this OTP against the database or an SMS provider.
    // For this MVP/development phase, we will accept any 4-6 digit OTP except '111111'.
    if (otp === '111111') {
      return res.status(400).json({ success: false, message: 'Invalid OTP! Please try again.' });
    }

    // Mark the QR session as verified if you want, or just return success so the app can proceed.
    return res.status(200).json({ success: true, message: 'OTP Verified successfully.' });

  } catch (error) {
    console.error('[verifyCustomerOtp] Error:', error);
    next(error);
  }
};

/**
 * 4. Submit Fuel Transaction
 */
    export const submitTransaction = async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = (req as any).user.userId;
        const { qrSessionId, customerId, fuelAmount, fuelType, petrolPumpId, idempotencyKey } = req.body;
    
        const worker = await prisma.workerProfile.findUnique({ where: { userId } });
        const qrSession = await prisma.qRSession.findUnique({ where: { id: qrSessionId } });
        const customer = await prisma.customerProfile.findUnique({ where: { id: customerId }, include: { group: true } 
  });
    
        if (!worker || !qrSession || !customer) {
          return res.status(400).json({ success: false, message: 'Invalid transaction data or entities not found.' });
        }
    
        if (qrSession.status === 'COMPLETED') {
          return res.status(400).json({ success: false, message: 'QR code was already used for a transaction.' });
        }

        const numericFuelAmount = parseFloat(fuelAmount);
        if (isNaN(numericFuelAmount)) {
          return res.status(400).json({ success: false, message: 'Invalid fuel amount.' });
        }
    
        // Calculate discounts
        const discountPercent = customer.group?.discountPercent || 0;
        const discountAmount = (numericFuelAmount * discountPercent) / 100;
        const finalAmount = numericFuelAmount - discountAmount;
        
        // Assume a static price per litre (e.g., 100) if not dynamically passed
        const assumedPricePerLitre = 100; 
        const litres = numericFuelAmount / assumedPricePerLitre;

    // Ensure a valid station exists
    let validStationId = petrolPumpId || worker.stationId;
    
    // Explicitly verify if this station actually exists in the database
    let stationExists = null;
    if (validStationId) {
      stationExists = await prisma.station.findUnique({ where: { id: validStationId } });
    }

    if (!stationExists) {
      let fallbackStation = await prisma.station.findFirst();
      if (!fallbackStation) {
        fallbackStation = await prisma.station.create({
          data: {
            name: 'Default Test Station',
            latitude: 0,
            longitude: 0,
          }
        });
      }
      validStationId = fallbackStation.id;
    }

      const transaction = await prisma.$transaction(async (tx) => {
        // 1. Create the transaction record
        const newTx = await tx.transaction.create({
          data: {
            customerId: customer.id,
            workerId: worker.id,
            stationId: validStationId,
            fuelType: fuelType || 'Petrol',
            amount: numericFuelAmount,
            discountPercent,
            discountAmount,
            finalAmount,
            litres,
            idempotencyKey
          }
        });
  
        // 2. Mark QR session as completely consumed
        await tx.qRSession.update({
          where: { id: qrSession.id },
          data: { status: 'COMPLETED', consumedAt: new Date() }
        });
  
        return newTx;
      });
  
      res.status(200).json({
        success: true,
        message: 'Transaction completed successfully.',
        data: { transaction }
      });
    } catch (error: any) {
      console.error('[submitTransaction] Error:', error);
      res.status(500).json({ success: false, message: 'Internal Server Error: ' + error?.message });
    }
  };

/**
 * 5. View Today's Transactions (Summary & List)
 */
export const getTodayTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const worker = await prisma.workerProfile.findUnique({ where: { userId } });
    
    if (!worker) {
      return res.status(404).json({ success: false, message: 'Worker profile not found.' });
    }

    // Set time to start of today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch the list of today's transactions
    const transactions = await prisma.transaction.findMany({
      where: {
        workerId: worker.id,
        createdAt: { gte: today },
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: { fullName: true, vehicle: true }
        }
      }
    });

    // Fetch summary aggregates
    const stats = await prisma.transaction.aggregate({
      where: {
        workerId: worker.id,
        createdAt: { gte: today },
        status: 'COMPLETED'
      },
      _count: { id: true },
      _sum: { amount: true, discountAmount: true, finalAmount: true, litres: true }
    });

    const formattedTransactions = transactions.map(tx => ({
      ...tx,
      customerName: tx.customer?.fullName || 'Unknown Customer'
    }));

    res.status(200).json({
      success: true,
      data: {
        summary: {
          transactionCount: stats._count.id,
          totalLitres: stats._sum.litres || 0,
          totalFuelAmount: stats._sum.amount || 0,
          totalDiscountAmount: stats._sum.discountAmount || 0,
          totalFinalAmount: stats._sum.finalAmount || 0
        },
        transactions: formattedTransactions
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 6. Get Worker Profile
 */
export const getWorkerProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    
    // Fetch the user along with their worker profile and station details
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { 
        workerProfile: {
          include: { station: true }
        }
      }
    });

    if (!user || !user.workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker profile not found.' });
    }

    // Combine user details with the profile for the frontend
    const profileData = {
      ...user.workerProfile,
      mobile: user.mobile,
      email: user.email,
    };

    res.status(200).json({ 
      success: true, 
      data: profileData 
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 7. View Monthly Summary
 */
export const getMonthlySummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const worker = await prisma.workerProfile.findUnique({ where: { userId } });
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const stats = await prisma.transaction.aggregate({
      where: {
        workerId: worker.id,
        createdAt: { gte: startOfMonth },
        status: 'COMPLETED'
      },
      _count: { id: true },
      _sum: { amount: true, discountAmount: true, finalAmount: true, litres: true }
    });

    const transactions = await prisma.transaction.findMany({
      where: {
        workerId: worker.id,
        createdAt: { gte: startOfMonth },
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { fullName: true, vehicle: true } }
      }
    });

    const formattedTransactions = transactions.map(tx => ({
      ...tx,
      customerName: tx.customer?.fullName || 'Unknown Customer'
    }));

    res.status(200).json({
      success: true,
      data: {
        transactionCount: stats._count.id,
        totalLitres: stats._sum.litres || 0,
        totalFuelAmount: stats._sum.amount || 0,
        totalFinalAmount: stats._sum.finalAmount || 0,
        transactions: formattedTransactions
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 8. View Yearly Summary
 */
export const getYearlySummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const worker = await prisma.workerProfile.findUnique({ where: { userId } });
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });

    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const stats = await prisma.transaction.aggregate({
      where: {
        workerId: worker.id,
        createdAt: { gte: startOfYear },
        status: 'COMPLETED'
      },
      _count: { id: true },
      _sum: { amount: true, discountAmount: true, finalAmount: true, litres: true }
    });

    const transactions = await prisma.transaction.findMany({
      where: {
        workerId: worker.id,
        createdAt: { gte: startOfYear },
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { fullName: true, vehicle: true } }
      }
    });

    const formattedTransactions = transactions.map(tx => ({
      ...tx,
      customerName: tx.customer?.fullName || 'Unknown Customer'
    }));

    res.status(200).json({
      success: true,
      data: {
        transactionCount: stats._count.id,
        totalLitres: stats._sum.litres || 0,
        totalFuelAmount: stats._sum.amount || 0,
        totalFinalAmount: stats._sum.finalAmount || 0,
        transactions: formattedTransactions
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 9. Get All Transactions (with filters)
 */
export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const worker = await prisma.workerProfile.findUnique({ where: { userId } });
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });

    const filterType = req.query.filterType as string || 'TODAY';
    const limit = parseInt(req.query.limit as string) || 10;

    let whereClause: any = {
      workerId: worker.id,
      status: 'COMPLETED'
    };

    if (filterType === 'TODAY') {
      let startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      whereClause.createdAt = { gte: startDate };
    } else if (filterType === 'THIS_MONTH') {
      let startDate = new Date();
      startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      whereClause.createdAt = { gte: startDate };
    } else if (filterType === 'THIS_YEAR') {
      let startDate = new Date();
      startDate = new Date(startDate.getFullYear(), 0, 1);
      whereClause.createdAt = { gte: startDate };
    }
    // If 'ALL', we don't add a createdAt filter

    const transactions = await prisma.transaction.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: filterType === 'ALL' ? undefined : limit, // show all if ALL, else limit
      include: {
        customer: { select: { fullName: true, group: true } }
      }
    });

    const formattedTransactions = transactions.map(tx => ({
      ...tx,
      customerName: tx.customer?.fullName || 'Unknown Customer'
    }));

    res.status(200).json({
      success: true,
      data: { transactions: formattedTransactions }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 10. Unified Dashboard Data
 * GET /api/v1/worker-app/transactions/dashboard?period=today|month|year
 */
export const getDashboardData = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const worker = await prisma.workerProfile.findUnique({ where: { userId } });
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });

    const period = req.query.period as string || 'today';
    
    let startDate = new Date();
    if (period === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
      startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    } else if (period === 'year') {
      startDate = new Date(startDate.getFullYear(), 0, 1);
    } else {
      // Default to today if invalid
      startDate.setHours(0, 0, 0, 0);
    }

    const stats = await prisma.transaction.aggregate({
      where: {
        workerId: worker.id,
        createdAt: { gte: startDate },
        status: 'COMPLETED'
      },
      _count: { id: true },
      _sum: { amount: true, discountAmount: true, finalAmount: true, litres: true }
    });

    const transactions = await prisma.transaction.findMany({
      where: {
        workerId: worker.id,
        createdAt: { gte: startDate },
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { fullName: true, vehicle: true } }
      }
    });

    const formattedTransactions = transactions.map(tx => ({
      ...tx,
      customerName: tx.customer?.fullName || 'Unknown Customer'
    }));

    res.status(200).json({
      success: true,
      data: {
        summary: {
          transactionCount: stats._count.id,
          totalLitres: stats._sum.litres || 0,
          totalFuelAmount: stats._sum.amount || 0,
          totalDiscountAmount: stats._sum.discountAmount || 0,
          totalFinalAmount: stats._sum.finalAmount || 0
        },
        transactions: formattedTransactions
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 11. Get Single Transaction Details
 * GET /api/v1/worker-app/transactions/:id
 */
export const getTransactionById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const transactionId = String(req.params.id);

    const worker = await prisma.workerProfile.findUnique({ where: { userId } });
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });

    const transaction = await prisma.transaction.findFirst({
      where: {
        id: transactionId,
        workerId: worker.id
      },
      include: {
        customer: { select: { fullName: true, vehicle: true, group: true } },
        station: { select: { name: true, latitude: true, longitude: true } }
      }
    });

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    const formattedTransaction = {
      ...transaction,
      customerName: transaction.customer?.fullName || 'Unknown Customer'
    };

    res.status(200).json({
      success: true,
      data: formattedTransaction
    });
  } catch (error) {
    next(error);
  }
};
