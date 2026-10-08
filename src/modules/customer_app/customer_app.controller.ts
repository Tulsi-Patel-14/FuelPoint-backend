import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateTokens } from '../../utils/jwt';
import crypto from 'crypto';

const prisma = new PrismaClient();

// In-memory store for OTPs (For production, consider using Redis)
const otpStore = new Map<string, { otp: string; expiresAt: number }>();

// 0. Register Customer
export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mobile, email, fullName, vehicle } = req.body;

    if (!mobile || !fullName) {
      return res.status(400).json({ success: false, message: 'Mobile and Full Name are required.' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { mobile },
          { email: email || undefined }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ success: false, message: 'A user with this mobile number or email already exists.' });
    }

    // Get default group for new customers
    const defaultGroup = await prisma.group.findFirst({
      where: { isDefault: true, isDeleted: false }
    });

    // Create User and CustomerProfile
    const user = await prisma.user.create({
      data: {
        mobile,
        email: email || null,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        customerProfile: {
          create: {
            fullName,
            vehicle: vehicle || null,
            groupId: defaultGroup?.id
          }
        }
      },
      include: { customerProfile: true }
    });

    // Generate tokens for auto-login after registration
    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        token: accessToken,
        refreshToken,
        customer: {
          ...user.customerProfile,
          mobile: user.mobile,
          email: user.email
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// 1. Request OTP (Only existing CUSTOMER users)
export const requestOtp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mobile } = req.body;
    console.log(`\n[requestOtp] Incoming request for mobile: ${mobile}`);

    const cleanMobile = String(mobile || '').trim();
    const without91 = cleanMobile.startsWith('91') && cleanMobile.length > 10 ? cleanMobile.slice(2) : cleanMobile;
    const with91 = cleanMobile.startsWith('91') ? cleanMobile : `91${cleanMobile}`;

    // Check if customer exists in the database (handle both raw and 91 prefixed)
    const user = await prisma.user.findFirst({
      where: {
        role: 'CUSTOMER',
        OR: [
          { mobile: cleanMobile },
          { mobile: without91 },
          { mobile: with91 }
        ]
      }
    });

    if (!user) {
      console.warn(`[requestOtp] Customer not found for: ${cleanMobile}`);
      return res.status(404).json({ success: false, message: 'Customer not found. Please register first.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, message: 'Account is pending approval or suspended.' });
    }

    // Generate a 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Store OTP in memory for both forms so verification succeeds
    otpStore.set(cleanMobile, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
    otpStore.set(user.mobile || cleanMobile, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

    // Mock sending message by printing to console
    console.log(`\n📲 [SMS MOCK] Sending OTP to Customer ${cleanMobile} (User: ${user.mobile}): ${otp}\n`);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully to registered mobile number.',
      otp: otp
    });
  } catch (error) {
    console.error('[requestOtp] Error:', error);
    next(error);
  }
};

// 2. Verify OTP and Login
export const verifyOtpAndLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mobile, otp } = req.body;
    const cleanMobile = String(mobile || '').trim();
    const without91 = cleanMobile.startsWith('91') && cleanMobile.length > 10 ? cleanMobile.slice(2) : cleanMobile;
    const with91 = cleanMobile.startsWith('91') ? cleanMobile : `91${cleanMobile}`;

    const record = otpStore.get(cleanMobile) || otpStore.get(without91) || otpStore.get(with91);

    if (!record) {
      return res.status(400).json({ success: false, message: 'No OTP requested for this mobile number.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(cleanMobile);
      return res.status(400).json({ success: false, message: 'OTP has expired.' });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    // OTP verified successfully, clear it
    otpStore.delete(cleanMobile);
    otpStore.delete(without91);
    otpStore.delete(with91);

    let user = await prisma.user.findFirst({
      where: {
        role: 'CUSTOMER',
        OR: [
          { mobile: cleanMobile },
          { mobile: without91 },
          { mobile: with91 }
        ]
      },
      include: { customerProfile: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token: accessToken,
        refreshToken,
        customer: {
          ...user.customerProfile,
          mobile: user.mobile,
          email: user.email
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// 3. Get Profile (Now includes all Dashboard Stats for Home Screen!)
export const getProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        customerProfile: {
          include: {
            transactions: {
              where: { status: 'COMPLETED' },
              orderBy: { createdAt: 'desc' }
            }
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const profile = user.customerProfile!;

    // Calculate dates for filters
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Helper to calculate stats from an array of transactions
    const calcStats = (txs: any[]) => ({
      visits: txs.length,
      fuelLiters: txs.reduce((acc, tx) => acc + tx.litres, 0),
      spent: txs.reduce((acc, tx) => acc + tx.finalAmount, 0)
    });

    const todayTxs = profile.transactions.filter(t => new Date(t.createdAt) >= today);
    const monthTxs = profile.transactions.filter(t => new Date(t.createdAt) >= startOfMonth);
    const yearTxs = profile.transactions.filter(t => new Date(t.createdAt) >= startOfYear);

    res.status(200).json({
      success: true,
      data: {
        ...profile,
        mobile: user.mobile,
        email: user.email,
        stats: {
          today: calcStats(todayTxs),
          thisMonth: calcStats(monthTxs),
          thisYear: calcStats(yearTxs),
          allTime: calcStats(profile.transactions)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// 3. Generate QR
export const generateQR = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { stationId } = req.body;

    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 1000);

    const qrSession = await prisma.qRSession.create({
      data: {
        token,
        customerId: profile.id,
        stationId,
        expiresAt,
        status: 'ACTIVE'
      }
    });

    res.status(200).json({
      success: true,
      data: {
        token: qrSession.token,
        qrValue: `fuel://customer/${qrSession.token}`,
        expiresAt: qrSession.expiresAt.getTime(),
        expiresIn: 60 // Provide direct seconds to avoid clock sync issues
      }
    });
  } catch (error) {
    next(error);
  }
};

// 4. Get QR Status
export const getQRStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params.token as string;
    const qrSession = await prisma.qRSession.findUnique({
      where: { token }
    });

    if (!qrSession) {
      return res.status(404).json({ success: false, message: 'QR not found' });
    }

    let status = qrSession.status;
    if (status === 'ACTIVE' && new Date() > qrSession.expiresAt) {
      status = 'EXPIRED';
      await prisma.qRSession.update({
        where: { id: qrSession.id },
        data: { status: 'EXPIRED' }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        status,
        expiresAt: qrSession.expiresAt.getTime()
      }
    });
  } catch (error) {
    next(error);
  }
};

// 5. Get Stations
export const getStations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stations = await prisma.station.findMany({
      where: { active: true }
    });
    res.status(200).json({ success: true, data: stations });
  } catch (error) {
    next(error);
  }
};

// 6. Unified Dashboard Data
export const getDashboardData = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found.' });

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
        customerId: profile.id,
        createdAt: { gte: startDate },
        status: 'COMPLETED'
      },
      _count: { id: true },
      _sum: { amount: true, discountAmount: true, finalAmount: true, litres: true }
    });

    const transactions = await prisma.transaction.findMany({
      where: {
        customerId: profile.id,
        createdAt: { gte: startDate },
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'desc' },
      include: { station: true, worker: { select: { fullName: true } } }
    });

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
        transactions
      }
    });
  } catch (error) {
    next(error);
  }
};

// 7. Get Today Transactions
export const getTodayTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found.' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = await prisma.transaction.aggregate({
      where: {
        customerId: profile.id,
        createdAt: { gte: today },
        status: 'COMPLETED'
      },
      _count: { id: true },
      _sum: { amount: true, discountAmount: true, finalAmount: true, litres: true }
    });

    const transactions = await prisma.transaction.findMany({
      where: {
        customerId: profile.id,
        createdAt: { gte: today },
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'desc' },
      include: { station: true, worker: { select: { fullName: true } } }
    });

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
        transactions
      }
    });
  } catch (error) {
    next(error);
  }
};

// 8. View Monthly Summary
export const getMonthlySummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found.' });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const stats = await prisma.transaction.aggregate({
      where: {
        customerId: profile.id,
        createdAt: { gte: startOfMonth },
        status: 'COMPLETED'
      },
      _count: { id: true },
      _sum: { amount: true, discountAmount: true, finalAmount: true, litres: true }
    });

    const transactions = await prisma.transaction.findMany({
      where: {
        customerId: profile.id,
        createdAt: { gte: startOfMonth },
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'desc' },
      include: { station: true, worker: { select: { fullName: true } } }
    });

    res.status(200).json({
      success: true,
      data: {
        transactionCount: stats._count.id,
        totalLitres: stats._sum.litres || 0,
        totalFuelAmount: stats._sum.amount || 0,
        totalFinalAmount: stats._sum.finalAmount || 0,
        transactions
      }
    });
  } catch (error) {
    next(error);
  }
};

// 9. View Yearly Summary
export const getYearlySummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found.' });

    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const stats = await prisma.transaction.aggregate({
      where: {
        customerId: profile.id,
        createdAt: { gte: startOfYear },
        status: 'COMPLETED'
      },
      _count: { id: true },
      _sum: { amount: true, discountAmount: true, finalAmount: true, litres: true }
    });

    const transactions = await prisma.transaction.findMany({
      where: {
        customerId: profile.id,
        createdAt: { gte: startOfYear },
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'desc' },
      include: { station: true, worker: { select: { fullName: true } } }
    });

    res.status(200).json({
      success: true,
      data: {
        transactionCount: stats._count.id,
        totalLitres: stats._sum.litres || 0,
        totalFuelAmount: stats._sum.amount || 0,
        totalFinalAmount: stats._sum.finalAmount || 0,
        transactions
      }
    });
  } catch (error) {
    next(error);
  }
};

// 10. Get All Transactions (with filters)
export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found.' });

    const filterType = req.query.filterType as string || 'TODAY';
    const limit = parseInt(req.query.limit as string) || 10;

    let whereClause: any = {
      customerId: profile.id,
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

    const transactions = await prisma.transaction.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: filterType === 'ALL' ? undefined : limit,
      include: { station: true, worker: { select: { fullName: true } } }
    });

    res.status(200).json({
      success: true,
      data: { transactions }
    });
  } catch (error) {
    next(error);
  }
};

// 11. Get Single Transaction Details
export const getTransactionById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const transactionId = String(req.params.id);

    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found.' });

    const transaction = await prisma.transaction.findFirst({
      where: {
        id: transactionId,
        customerId: profile.id
      },
      include: {
        station: { select: { name: true, latitude: true, longitude: true } },
        worker: { select: { fullName: true } }
      }
    });

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    res.status(200).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    console.error('[getTransactionById] Error:', error);
    next(error);
  }
};
