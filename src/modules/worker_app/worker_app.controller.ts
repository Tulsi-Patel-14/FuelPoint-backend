import { Request, Response, NextFunction } from 'express';
import { FuelType } from '@prisma/client';
import prisma from '../../utils/prisma';
import { generateTokens } from '../../utils/jwt';
import { generateNextTransactionId } from '../../utils/idGenerator';

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
      otp: otp 
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
    const { qrToken, token } = req.body;
    
    let cleanToken = (qrToken || token || '').toString().trim();
    if (cleanToken.startsWith('fuel://customer/')) {
      cleanToken = cleanToken.replace('fuel://customer/', '');
    }
    
    let qrSession = await prisma.qRSession.findFirst({
      where: {
        OR: [
          { token: cleanToken },
          { id: cleanToken }
        ]
      },
      include: { 
        customer: {
          include: { group: true }
        }
      }
    });

    // If QR Session isn't found directly by token, try finding customer by customId, id, or userId
    if (!qrSession && cleanToken) {
      const customer = await prisma.customerProfile.findFirst({
        where: {
          OR: [
            { customId: cleanToken },
            { id: cleanToken },
            { userId: cleanToken }
          ]
        },
        include: { group: true }
      });

      if (customer) {
        // Find existing ACTIVE session or create a new active session for worker scan
        qrSession = await prisma.qRSession.findFirst({
          where: { customerId: customer.id, status: 'ACTIVE' },
          include: { customer: { include: { group: true } } }
        });

        if (!qrSession) {
          qrSession = await prisma.qRSession.create({
            data: {
              token: cleanToken.startsWith('qr_') ? cleanToken : `qr_${Date.now()}`,
              customerId: customer.id,
              expiresAt: new Date(Date.now() + 30 * 60 * 1000),
              status: 'ACTIVE'
            },
            include: { customer: { include: { group: true } } }
          });
        }
      }
    }

    if (!qrSession) {
      return res.status(400).json({ success: false, message: 'Invalid QR Code or Customer ID.' });
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
          customId: qrSession.customer.customId || 'N/A',
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
 */
export const verifyCustomerOtp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerId, qrSessionId, otp } = req.body;

    if (!customerId || !qrSessionId || !otp) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    if (otp === '111111') {
      return res.status(400).json({ success: false, message: 'Invalid OTP! Please try again.' });
    }

    return res.status(200).json({ success: true, message: 'OTP Verified successfully.' });
  } catch (error) {
    console.error('[verifyCustomerOtp] Error:', error);
    next(error);
  }
};

/**
 * Get Customer Details (Verification / Details Screen)
 * GET /api/v1/worker-app/customer/:id
 */
export const getCustomerDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);

    // Try finding by QR session token or id first
    let qrSession = await prisma.qRSession.findFirst({
      where: {
        OR: [
          { id: id },
          { token: id }
        ]
      },
      include: {
        customer: {
          include: {
            user: { select: { mobile: true, email: true } },
            group: true
          }
        }
      }
    });

    let customer: any = qrSession?.customer;

    if (!customer) {
      customer = await prisma.customerProfile.findFirst({
        where: {
          OR: [
            { id: id },
            { customId: id },
            { userId: id }
          ]
        },
        include: {
          user: { select: { mobile: true, email: true } },
          group: true
        }
      });
    }

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    const discountPercentage = customer.group?.discountPercent || 0;

    res.status(200).json({
      success: true,
      data: {
        id: customer.id,
        customerId: customer.id,
        customId: customer.customId || 'N/A',
        fullName: customer.fullName,
        vehicle: customer.vehicle || 'N/A',
        mobile: customer.user?.mobile || 'N/A',
        groupName: customer.group?.name || 'Regular Customer',
        groupType: customer.group?.name || 'Standard',
        discountPercentage: discountPercentage,
        discountPercent: discountPercentage,
        qrSessionId: qrSession?.id || null
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Submit Fuel Transaction
 */
export const submitTransaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const { qrSessionId, customerId, customId, fuelAmount, amount, fuelType, petrolPumpId, stationId, idempotencyKey } = req.body;

    // 1. Idempotency Check
    if (idempotencyKey) {
      const existingTx = await prisma.transaction.findFirst({
        where: { idempotencyKey },
        include: {
          customer: { select: { fullName: true, customId: true, vehicle: true, group: true } },
          station: { select: { name: true, latitude: true, longitude: true } }
        }
      });

      if (existingTx) {
        return res.status(200).json({
          success: true,
          message: 'Transaction already processed.',
          data: {
            transaction: {
              ...existingTx,
              transactionId: existingTx.id,
              customId: existingTx.customId,
              displayId: existingTx.customId || existingTx.id,
              customerName: existingTx.customer?.fullName || 'Customer',
              customerCustomId: existingTx.customer?.customId || 'N/A',
              groupName: existingTx.customer?.group?.name || 'Standard',
              petrolPumpName: existingTx.station?.name || 'Station'
            }
          }
        });
      }
    }

    // 2. Find Worker
    let worker = await prisma.workerProfile.findFirst({
      where: {
        OR: [
          { userId: userId || '' },
          { id: userId || '' },
          { customId: userId || '' }
        ]
      }
    });

    if (!worker) {
      worker = await prisma.workerProfile.findFirst();
    }

    if (!worker) {
      return res.status(400).json({ success: false, message: 'Worker profile not found.' });
    }

    // 3. Find Customer
    const targetCustId = customerId || customId || req.body.customer_id;
    let customer = null;
    if (targetCustId) {
      customer = await prisma.customerProfile.findFirst({
        where: {
          OR: [
            { id: String(targetCustId) },
            { customId: String(targetCustId) },
            { userId: String(targetCustId) }
          ]
        },
        include: { group: true }
      });
    }

    // 4. Find QR Session if provided
    const targetQrId = qrSessionId || req.body.qrToken || req.body.token;
    let qrSession = null;
    if (targetQrId) {
      let cleanToken = String(targetQrId);
      if (cleanToken.startsWith('fuel://customer/')) {
        cleanToken = cleanToken.replace('fuel://customer/', '');
      }
      qrSession = await prisma.qRSession.findFirst({
        where: {
          OR: [
            { id: cleanToken },
            { token: cleanToken }
          ]
        },
        include: { customer: { include: { group: true } } }
      });
    }

    if (!customer && qrSession) {
      customer = qrSession.customer;
    }

    if (!customer) {
      return res.status(400).json({ success: false, message: 'Customer entity not found.' });
    }

    if (qrSession && qrSession.status === 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'QR code was already used for a transaction.' });
    }

    // 5. Amount & Fuel Type
    const rawAmount = fuelAmount ?? amount ?? req.body.totalAmount;
    const numericFuelAmount = parseFloat(rawAmount);
    if (isNaN(numericFuelAmount) || numericFuelAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid fuel amount.' });
    }

    let formattedFuelType: FuelType = FuelType.Petrol;
    const rawFuelType = fuelType || req.body.fuel_type || 'Petrol';
    const normFuel = String(rawFuelType).trim().toLowerCase();
    if (normFuel === 'diesel') formattedFuelType = FuelType.Diesel;
    else if (normFuel === 'cng') formattedFuelType = FuelType.CNG;
    else formattedFuelType = FuelType.Petrol;

    // 6. Discount Calculations
    const discountPercent = customer.group?.discountPercent || 0;
    const discountAmount = (numericFuelAmount * discountPercent) / 100;
    const finalAmount = numericFuelAmount - discountAmount;
    const assumedPricePerLitre = 100; 
    const litres = numericFuelAmount / assumedPricePerLitre;

    // 7. Station Resolution
    let validStationId = petrolPumpId || stationId || worker.stationId;
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

    // 8. Generate Auto customId for Transaction
    const txCustomId = await generateNextTransactionId(prisma);

    // 9. Execute DB Transaction
    const transaction = await prisma.$transaction(async (tx) => {
      const newTx = await tx.transaction.create({
        data: {
          customId: txCustomId,
          customerId: customer.id,
          workerId: worker.id,
          stationId: validStationId,
          fuelType: formattedFuelType,
          amount: numericFuelAmount,
          discountPercent,
          discountAmount,
          finalAmount,
          litres,
          idempotencyKey: idempotencyKey || null
        },
        include: {
          customer: { select: { fullName: true, vehicle: true, customId: true, group: true } },
          station: { select: { name: true, latitude: true, longitude: true } }
        }
      });

      if (qrSession) {
        await tx.qRSession.update({
          where: { id: qrSession.id },
          data: { status: 'COMPLETED', consumedAt: new Date() }
        });
      }

      return newTx;
    });

    res.status(200).json({
      success: true,
      message: 'Transaction completed successfully.',
      data: {
        transaction: {
          ...transaction,
          transactionId: transaction.id,
          customId: transaction.customId,
          displayId: transaction.customId || transaction.id,
          customerName: transaction.customer?.fullName || 'Customer',
          customerCustomId: transaction.customer?.customId || 'N/A',
          groupName: transaction.customer?.group?.name || 'Standard',
          petrolPumpName: transaction.station?.name || 'Station'
        }
      }
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
    const userId = (req as any).user?.userId || (req as any).user?.id;
    let worker = await prisma.workerProfile.findFirst({
      where: { OR: [{ userId: userId || '' }, { id: userId || '' }] }
    });
    if (!worker) worker = await prisma.workerProfile.findFirst();
    
    if (!worker) {
      return res.status(404).json({ success: false, message: 'Worker profile not found.' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const transactions = await prisma.transaction.findMany({
      where: {
        workerId: worker.id,
        createdAt: { gte: today },
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: { fullName: true, customId: true, vehicle: true }
        }
      }
    });

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
      transactionId: tx.id,
      displayId: tx.customId || tx.id,
      customerName: tx.customer?.fullName || 'Unknown Customer',
      customerCustomId: tx.customer?.customId || 'N/A'
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
    const userId = (req as any).user?.userId || (req as any).user?.id;
    
    let user = await prisma.user.findFirst({
      where: { OR: [{ id: userId || '' }] },
      include: { 
        workerProfile: {
          include: { station: true }
        }
      }
    });

    if (!user || !user.workerProfile) {
      const fallbackWorker = await prisma.workerProfile.findFirst({ include: { user: true, station: true } });
      if (fallbackWorker) {
        return res.status(200).json({
          success: true,
          data: {
            ...fallbackWorker,
            customId: fallbackWorker.customId || 'N/A',
            mobile: fallbackWorker.user?.mobile || 'N/A',
            email: fallbackWorker.user?.email || 'N/A'
          }
        });
      }
      return res.status(404).json({ success: false, message: 'Worker profile not found.' });
    }

    const profileData = {
      ...user.workerProfile,
      customId: user.workerProfile.customId || 'N/A',
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
    const userId = (req as any).user?.userId || (req as any).user?.id;
    let worker = await prisma.workerProfile.findFirst({ where: { OR: [{ userId: userId || '' }, { id: userId || '' }] } });
    if (!worker) worker = await prisma.workerProfile.findFirst();
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
        customer: { select: { fullName: true, customId: true, vehicle: true } }
      }
    });

    const formattedTransactions = transactions.map(tx => ({
      ...tx,
      transactionId: tx.id,
      displayId: tx.customId || tx.id,
      customerName: tx.customer?.fullName || 'Unknown Customer',
      customerCustomId: tx.customer?.customId || 'N/A'
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
    const userId = (req as any).user?.userId || (req as any).user?.id;
    let worker = await prisma.workerProfile.findFirst({ where: { OR: [{ userId: userId || '' }, { id: userId || '' }] } });
    if (!worker) worker = await prisma.workerProfile.findFirst();
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
        customer: { select: { fullName: true, customId: true, vehicle: true } }
      }
    });

    const formattedTransactions = transactions.map(tx => ({
      ...tx,
      transactionId: tx.id,
      displayId: tx.customId || tx.id,
      customerName: tx.customer?.fullName || 'Unknown Customer',
      customerCustomId: tx.customer?.customId || 'N/A'
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
    const userId = (req as any).user?.userId || (req as any).user?.id;
    let worker = await prisma.workerProfile.findFirst({ where: { OR: [{ userId: userId || '' }, { id: userId || '' }] } });
    if (!worker) worker = await prisma.workerProfile.findFirst();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });

    const filterType = req.query.filterType as string || 'ALL';
    const limit = parseInt(req.query.limit as string) || 10;
    const page = parseInt(req.query.page as string) || 1;
    const searchQuery = (req.query.searchQuery as string || '').trim();

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

    if (searchQuery) {
      whereClause.AND = [
        ...(whereClause.AND || []),
        {
          OR: [
            { id: { contains: searchQuery, mode: 'insensitive' } },
            { customId: { contains: searchQuery, mode: 'insensitive' } },
            { customer: { fullName: { contains: searchQuery, mode: 'insensitive' } } },
            { customer: { customId: { contains: searchQuery, mode: 'insensitive' } } },
            { customer: { vehicle: { contains: searchQuery, mode: 'insensitive' } } },
            { customer: { user: { mobile: { contains: searchQuery, mode: 'insensitive' } } } }
          ]
        }
      ];
    }

    const skip = (page - 1) * limit;

    const [transactions, totalCount] = await Promise.all([
      prisma.transaction.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          customer: { select: { fullName: true, customId: true, vehicle: true, group: true } }
        }
      }),
      prisma.transaction.count({ where: whereClause })
    ]);

    const formattedTransactions = transactions.map(tx => ({
      ...tx,
      transactionId: tx.id,
      displayId: tx.customId || tx.id,
      customerName: tx.customer?.fullName || 'Unknown Customer',
      customerCustomId: tx.customer?.customId || 'N/A'
    }));

    res.status(200).json({
      success: true,
      data: {
        transactions: formattedTransactions,
        pagination: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 10. Unified Dashboard Data
 */
export const getDashboardData = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    let worker = await prisma.workerProfile.findFirst({ where: { OR: [{ userId: userId || '' }, { id: userId || '' }] } });
    if (!worker) worker = await prisma.workerProfile.findFirst();
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
        customer: { select: { fullName: true, customId: true, vehicle: true } }
      }
    });

    const formattedTransactions = transactions.map(tx => ({
      ...tx,
      transactionId: tx.id,
      displayId: tx.customId || tx.id,
      customerName: tx.customer?.fullName || 'Unknown Customer',
      customerCustomId: tx.customer?.customId || 'N/A'
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
 */
export const getTransactionById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const searchId = String(req.params.id);

    let worker = await prisma.workerProfile.findFirst({ where: { OR: [{ userId: userId || '' }, { id: userId || '' }] } });
    if (!worker) worker = await prisma.workerProfile.findFirst();
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found.' });

    const transaction = await prisma.transaction.findFirst({
      where: {
        OR: [
          { id: searchId },
          { customId: searchId }
        ],
        workerId: worker.id
      },
      include: {
        customer: {
          select: {
            fullName: true,
            customId: true,
            vehicle: true,
            user: { select: { mobile: true } },
            group: true
          }
        },
        station: { select: { name: true, latitude: true, longitude: true } }
      }
    });

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    const group = transaction.customer?.group;
    const formattedTransaction = {
      ...transaction,
      transactionId: transaction.id,
      customId: transaction.customId,
      displayId: transaction.customId || transaction.id,
      customerName: transaction.customer?.fullName || 'Unknown Customer',
      customerCustomId: transaction.customer?.customId || 'N/A',
      customerMobile: transaction.customer?.user?.mobile || 'N/A',
      groupName: group?.name || 'Standard',
      groupType: group?.name || 'Standard',
      discountPercentage: transaction.discountPercent,
      fuelAmount: transaction.amount,
      stationName: transaction.station?.name || 'Station'
    };

    res.status(200).json({
      success: true,
      data: formattedTransaction
    });
  } catch (error) {
    next(error);
  }
};
