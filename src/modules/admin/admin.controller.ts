import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateTokens } from '../../utils/jwt';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { sendPasswordResetEmail } from '../../utils/email';

const prisma = new PrismaClient();

// In-memory rate limiting map for forgot password requests (max 5 requests per 15 mins per IP/email)
const resetRateLimitMap = new Map<string, { count: number; firstRequest: number }>();

const isRateLimited = (key: string): boolean => {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 5;

  const record = resetRateLimitMap.get(key);
  if (!record || now - record.firstRequest > windowMs) {
    resetRateLimitMap.set(key, { count: 1, firstRequest: now });
    return false;
  }

  if (record.count >= maxRequests) {
    return true;
  }

  record.count += 1;
  return false;
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { email },
      include: { adminProfile: true }
    });

    if (!user || user.role !== 'ADMIN' || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    res.status(200).json({
      success: true,
      data: {
        token: accessToken,
        admin: user.adminProfile
      }
    });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;

    // Validate email presence and format
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    // Rate limit per IP and per normalized email
    if (isRateLimited(`ip:${clientIp}`) || isRateLimited(`email:${normalizedEmail}`)) {
      return res.status(429).json({
        success: false,
        message: 'Too many password reset requests. Please try again in 15 minutes.'
      });
    }

    // Generic response message to prevent email/account enumeration
    const genericResponse = {
      success: true,
      message: 'If an account exists for this email, a password reset link has been sent.'
    };

    const user = await prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        role: { in: ['ADMIN', 'SUPER_ADMIN'] }
      },
      include: { adminProfile: true }
    });

    // If account doesn't exist, return identical generic response
    if (!user) {
      return res.status(200).json(genericResponse);
    }

    // 1. Invalidate any existing unused reset tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() }
    });

    // 2. Clean up expired tokens
    await prisma.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: new Date() } }
    });

    // 3. Generate cryptographically secure random token (64 hex characters)
    const rawToken = crypto.randomBytes(32).toString('hex');

    // 4. Compute SHA-256 hash for database storage (never store raw token)
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // 5. Expiration time (default 30 mins)
    const expiresMinutes = parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES || '30', 10);
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt
      }
    });

    // 6. Build reset URL using configured FRONTEND_URL
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/+$/, '');
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    // 7. Send email via SMTP
    try {
      await sendPasswordResetEmail(user.email || normalizedEmail, resetUrl, user.adminProfile?.fullName);
    } catch (mailError) {
      console.error('[EMAIL ERROR] Failed to dispatch password reset email:', mailError);
    }

    return res.status(200).json(genericResponse);
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({
        success: false,
        message: 'This password reset link is invalid or has expired.'
      });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long.'
      });
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match.'
      });
    }

    // Hash supplied raw token to match against database hash
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    const tokenRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true }
    });

    const now = new Date();
    // Validate token exists, has not been used, and has not expired
    if (!tokenRecord || tokenRecord.usedAt !== null || tokenRecord.expiresAt < now) {
      return res.status(400).json({
        success: false,
        message: 'This password reset link is invalid or has expired.'
      });
    }

    const user = tokenRecord.user;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      return res.status(400).json({
        success: false,
        message: 'This password reset link is invalid or has expired.'
      });
    }

    // Hash new password with existing bcrypt mechanism (same as seed/admin controller)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Atomically update password and mark reset token as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword }
      }),
      prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: now }
      }),
      // Invalidate any other outstanding reset tokens for this user
      prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null, id: { not: tokenRecord.id } },
        data: { usedAt: now }
      })
    ]);

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully.'
    });
  } catch (error) {
    next(error);
  }
};

export const verifyResetToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawToken = (req.query.token as string) || req.body?.token;

    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'This password reset link is invalid or has expired.'
      });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');

    const tokenRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true }
    });

    const now = new Date();
    if (!tokenRecord || tokenRecord.usedAt !== null || tokenRecord.expiresAt < now) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'This password reset link is invalid or has expired.'
      });
    }

    const user = tokenRecord.user;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'This password reset link is invalid or has expired.'
      });
    }

    return res.status(200).json({
      success: true,
      valid: true,
      message: 'Password reset link is valid.'
    });
  } catch (error) {
    next(error);
  }
};

export const getDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days as string) || 30));
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 1. Core database queries
    const [
      totalCustomers,
      totalWorkers,
      activeWorkers,
      groups,
      allPeriodTransactions,
      todayTransactionsAgg,
      recentTxnsRaw,
      periodCustomers
    ] = await Promise.all([
      // Total non-deleted customers
      prisma.customerProfile.count({ where: { isDeleted: false } }),
      // Total non-deleted workers
      prisma.workerProfile.count({ where: { isDeleted: false } }),
      // Active workers
      prisma.workerProfile.count({
        where: { isDeleted: false, user: { status: 'ACTIVE' } }
      }),
      // Active groups with their non-deleted customers count and transactions
      prisma.group.findMany({
        where: { isDeleted: false },
        include: {
          customers: {
            where: { isDeleted: false },
            select: { id: true }
          }
        }
      }),
      // Completed transactions in this period
      prisma.transaction.findMany({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: cutoff }
        },
        select: {
          id: true,
          amount: true,
          discountAmount: true,
          discountPercent: true,
          customerId: true,
          workerId: true,
          createdAt: true,
          customer: { select: { groupId: true } }
        }
      }),
      // Today's completed transactions aggregate
      prisma.transaction.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: startOfToday }
        },
        _count: { id: true },
        _sum: { discountAmount: true }
      }),
      // Latest 8 transactions with joined customer and worker
      prisma.transaction.findMany({
        where: { status: 'COMPLETED' },
        include: {
          customer: { select: { id: true, fullName: true, groupId: true } },
          worker: { select: { id: true, fullName: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 8
      }),
      // Customers registered in this period for timeline and growth
      prisma.customerProfile.findMany({
        where: {
          isDeleted: false,
          joinedAt: { gte: cutoff }
        },
        select: { id: true, joinedAt: true }
      })
    ]);

    // 2. Calculations for overview
    const totalTransactions = allPeriodTransactions.length;
    const totalDiscount = allPeriodTransactions.reduce((s, t) => s + (t.discountAmount || 0), 0);
    const totalRevenue = allPeriodTransactions.reduce((s, t) => s + (t.amount || 0), 0);
    const todayTransactions = todayTransactionsAgg._count.id || 0;
    const todayDiscount = todayTransactionsAgg._sum.discountAmount || 0;
    const avgDiscountPercent = totalRevenue > 0 ? (totalDiscount / totalRevenue) * 100 : 0;

    // 3. Build Daily Time Series (buckets) for charts
    const buckets = new Map<string, {
      date: string;
      label: string;
      transactions: number;
      discount: number;
      registrations: number;
      revenue: number;
    }>();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, {
        date: key,
        label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        transactions: 0,
        discount: 0,
        registrations: 0,
        revenue: 0,
      });
    }

    allPeriodTransactions.forEach((t) => {
      const key = new Date(t.createdAt).toISOString().slice(0, 10);
      const b = buckets.get(key);
      if (b) {
        b.transactions += 1;
        b.discount += (t.discountAmount || 0);
        b.revenue += (t.amount || 0);
      }
    });

    periodCustomers.forEach((c) => {
      const key = new Date(c.joinedAt).toISOString().slice(0, 10);
      const b = buckets.get(key);
      if (b) {
        b.registrations += 1;
      }
    });

    const series = Array.from(buckets.values());

    // Calculate growth deltas (% change between first half of period and second half)
    const half = Math.floor(series.length / 2);
    const calcDelta = (key: 'transactions' | 'discount' | 'registrations') => {
      const firstHalf = series.slice(0, half).reduce((s, p) => s + p[key], 0);
      const secondHalf = series.slice(half).reduce((s, p) => s + p[key], 0);
      if (!firstHalf) return 0;
      return Number((((secondHalf - firstHalf) / firstHalf) * 100).toFixed(1));
    };

    const deltaRegistrations = calcDelta('registrations');
    const deltaDiscount = calcDelta('discount');

    // 4. Group distribution
    const groupDistribution = groups.map((g) => {
      const groupTxns = allPeriodTransactions.filter((t) => t.customer?.groupId === g.id);
      return {
        id: g.id,
        name: g.name,
        discountPercent: g.discountPercent,
        active: g.active,
        customers: g.customers.length,
        transactions: groupTxns.length,
        discountGenerated: groupTxns.reduce((s, t) => s + (t.discountAmount || 0), 0)
      };
    });

    // 5. Worker activity (top workers by scans/transactions)
    const allWorkers = await prisma.workerProfile.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        fullName: true,
        scans: true,
        transactions: {
          where: { status: 'COMPLETED', createdAt: { gte: cutoff } },
          select: { id: true, discountAmount: true }
        }
      }
    });

    const workerActivity = allWorkers
      .map((w) => ({
        id: w.id,
        name: w.fullName ? w.fullName.split(' ')[0] : 'Worker',
        scans: w.scans,
        transactions: w.transactions.length,
        discountProcessed: w.transactions.reduce((s, t) => s + (t.discountAmount || 0), 0)
      }))
      .sort((a, b) => b.scans - a.scans)
      .slice(0, 8);

    // 6. Map recent transactions with clean fields
    const recentTransactions = recentTxnsRaw.map((t) => ({
      id: t.id,
      customerId: t.customerId,
      customerName: t.customer?.fullName || 'Customer',
      workerId: t.workerId,
      workerName: t.worker?.fullName || 'Worker',
      groupId: t.customer?.groupId || 'default',
      amount: t.amount,
      discountPercent: t.discountPercent,
      discountAmount: t.discountAmount,
      litres: t.litres,
      fuel: t.fuelType,
      createdAt: t.createdAt
    }));

    res.status(200).json({
      success: true,
      data: {
        days,
        overview: {
          totalCustomers,
          totalWorkers,
          activeWorkers,
          totalDiscount,
          totalRevenue,
          totalTransactions,
          todayTransactions,
          todayDiscount,
          avgDiscountPercent,
          deltaRegistrations,
          deltaDiscount
        },
        series,
        groupDistribution,
        workerActivity,
        recentTransactions
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt((req.query.limit || req.query.pageSize) as string) || 10);
    const isAll = req.query.all === 'true' || req.query.limit === '-1' || req.query.limit === '0';
    const skip = (page - 1) * limit;

    const { search, query: qSearch, q, groupId, status } = req.query;
    const searchTerm = (search || qSearch || q) as string;

    const whereClause: any = { isDeleted: false };

    // 1. Search filter: name, mobile, email, id, vehicle, address
    if (searchTerm && typeof searchTerm === 'string' && searchTerm.trim()) {
      const s = searchTerm.trim();
      whereClause.OR = [
        { fullName: { contains: s, mode: 'insensitive' } },
        { id: { contains: s, mode: 'insensitive' } },
        { vehicle: { contains: s, mode: 'insensitive' } },
        { address: { contains: s, mode: 'insensitive' } },
        { user: { mobile: { contains: s, mode: 'insensitive' } } },
        { user: { email: { contains: s, mode: 'insensitive' } } }
      ];
    }

    // 2. Group filter
    if (groupId && typeof groupId === 'string' && groupId !== 'all') {
      if (groupId === 'unassigned' || groupId === 'grp-default' || groupId === 'null') {
        whereClause.groupId = null;
      } else {
        whereClause.groupId = groupId;
      }
    }

    // 3. Status filter
    const validStatuses = ['PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'OFFLINE'];
    if (status && typeof status === 'string' && status !== 'all') {
      const upperStatus = status.toUpperCase();
      if (validStatuses.includes(upperStatus)) {
        whereClause.user = {
          ...(whereClause.user || {}),
          status: upperStatus
        };
      }
    }

    const [customers, total] = await Promise.all([
      prisma.customerProfile.findMany({
        where: whereClause,
        include: {
          user: true,
          group: true,
          transactions: {
            where: { status: 'COMPLETED' },
            include: { worker: true }
          }
        },
        orderBy: { joinedAt: 'desc' },
        ...(isAll ? {} : { skip, take: limit })
      }),
      prisma.customerProfile.count({ where: whereClause })
    ]);

    const totalPages = isAll ? 1 : (Math.ceil(total / limit) || 1);

    res.status(200).json({
      success: true,
      data: customers,
      pagination: {
        page: isAll ? 1 : page,
        limit: isAll ? total : limit,
        total,
        totalPages
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getCustomersSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalCustomers, newRegistrations7d, activeCustomers, usedPumpCount] = await Promise.all([
      prisma.customerProfile.count({
        where: { isDeleted: false }
      }),
      prisma.customerProfile.count({
        where: { isDeleted: false, joinedAt: { gte: sevenDaysAgo } }
      }),
      prisma.customerProfile.count({
        where: { isDeleted: false, user: { status: 'ACTIVE' } }
      }),
      prisma.customerProfile.count({
        where: {
          isDeleted: false,
          transactions: { some: { status: 'COMPLETED', createdAt: { gte: thirtyDaysAgo } } }
        }
      })
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalCustomers,
        newRegistrations7d,
        activeCustomers,
        usedPumpCustomers: usedPumpCount,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getWorkers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt((req.query.limit || req.query.pageSize) as string) || 10);
    const isAll = req.query.all === 'true' || req.query.limit === '-1' || req.query.limit === '0';
    const skip = (page - 1) * limit;

    const { search, query: qSearch, q, status, shift, sortBy, sortOrder } = req.query;
    const searchTerm = (search || qSearch || q) as string;
    const orderDir = ((sortOrder as string)?.toLowerCase() === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';
    const sortField = ((sortBy as string)?.toLowerCase() || 'joinedat');

    const whereClause: any = { isDeleted: false };

    // 1. Search filter: fullName, id, user.email, user.mobile
    if (searchTerm && typeof searchTerm === 'string' && searchTerm.trim()) {
      const s = searchTerm.trim();
      whereClause.OR = [
        { fullName: { contains: s, mode: 'insensitive' } },
        { id: { contains: s, mode: 'insensitive' } },
        { user: { email: { contains: s, mode: 'insensitive' } } },
        { user: { mobile: { contains: s, mode: 'insensitive' } } },
      ];
    }

    // 2. Status filter
    const validStatuses = ['PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'OFFLINE'];
    if (status && typeof status === 'string' && status !== 'all') {
      const upperStatus = status.toUpperCase();
      if (validStatuses.includes(upperStatus)) {
        whereClause.user = {
          ...(whereClause.user || {}),
          status: upperStatus
        };
      }
    }

    // 3. Shift filter
    if (shift && typeof shift === 'string' && shift !== 'all') {
      whereClause.shift = { equals: shift, mode: 'insensitive' };
    }

    const formatWorkerItem = (w: any) => {
      const txns = w.transactions || [];
      const discount = txns.reduce((sum: number, t: any) => sum + (t.discountAmount || 0), 0);
      const customers = new Set(txns.map((t: any) => t.customerId)).size;
      let lastAct = w.joinedAt;
      if (txns.length > 0) {
        const sortedTxns = [...txns].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        lastAct = sortedTxns[0].createdAt;
      }
      return {
        ...w,
        transactions: txns.length,
        discountProcessed: discount,
        customersScanned: customers,
        lastActivity: lastAct,
      };
    };

    const isComputedSort = ['discount', 'customers', 'last', 'lastactivity'].includes(sortField);

    let workers: any[] = [];
    let total = 0;

    if (isComputedSort) {
      const allMatching = await prisma.workerProfile.findMany({
        where: whereClause,
        include: {
          user: true,
          station: true,
          transactions: {
            where: { status: 'COMPLETED' },
            select: { id: true, customerId: true, amount: true, discountAmount: true, createdAt: true }
          }
        }
      });
      total = allMatching.length;
      const formatted = allMatching.map(formatWorkerItem);
      formatted.sort((a: any, b: any) => {
        let valA: any = 0;
        let valB: any = 0;
        if (sortField === 'discount') {
          valA = a.discountProcessed || 0;
          valB = b.discountProcessed || 0;
        } else if (sortField === 'customers') {
          valA = a.customersScanned || 0;
          valB = b.customersScanned || 0;
        } else if (sortField === 'last' || sortField === 'lastactivity') {
          valA = new Date(a.lastActivity).getTime();
          valB = new Date(b.lastActivity).getTime();
        }
        return orderDir === 'asc' ? (valA > valB ? 1 : valA < valB ? -1 : 0) : (valA < valB ? 1 : valA > valB ? -1 : 0);
      });
      workers = isAll ? formatted : formatted.slice(skip, skip + limit);
    } else {
      let orderBy: any = { joinedAt: 'desc' };
      if (sortField === 'name' || sortField === 'fullname') {
        orderBy = { fullName: orderDir };
      } else if (sortField === 'status') {
        orderBy = { user: { status: orderDir } };
      } else if (sortField === 'shift') {
        orderBy = { shift: orderDir };
      } else if (sortField === 'scans') {
        orderBy = { scans: orderDir };
      } else if (sortField === 'transactions') {
        orderBy = { transactions: { _count: orderDir } };
      } else if (sortField === 'joinedat') {
        orderBy = { joinedAt: orderDir };
      }

      const [rawWorkers, count] = await Promise.all([
        prisma.workerProfile.findMany({
          where: whereClause,
          include: {
            user: true,
            station: true,
            transactions: {
              where: { status: 'COMPLETED' },
              select: { id: true, customerId: true, amount: true, discountAmount: true, createdAt: true }
            }
          },
          orderBy,
          ...(isAll ? {} : { skip, take: limit })
        }),
        prisma.workerProfile.count({ where: whereClause })
      ]);
      total = count;
      workers = rawWorkers.map(formatWorkerItem);
    }

    const totalPages = isAll ? 1 : (Math.ceil(total / limit) || 1);

    res.status(200).json({
      success: true,
      data: workers,
      pagination: {
        page: isAll ? 1 : page,
        limit: isAll ? total : limit,
        total,
        totalPages
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getWorkersSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [totalWorkers, activeWorkers, scansAgg, discountAgg] = await Promise.all([
      prisma.workerProfile.count({
        where: { isDeleted: false }
      }),
      prisma.workerProfile.count({
        where: { isDeleted: false, user: { status: 'ACTIVE' } }
      }),
      prisma.workerProfile.aggregate({
        where: { isDeleted: false },
        _sum: { scans: true }
      }),
      prisma.transaction.aggregate({
        where: { status: 'COMPLETED', worker: { isDeleted: false } },
        _sum: { discountAmount: true }
      })
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalWorkers,
        activeWorkers,
        totalScans: scansAgg._sum.scans || 0,
        discountProcessed: discountAgg._sum.discountAmount || 0,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const createWorker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workerFullName = req.body.fullName || req.body.name;
    const email = req.body.email;
    const mobile = req.body.mobile || req.body.phone;
    const { password, shift, stationId, status } = req.body;

    if (!workerFullName) {
      return res.status(400).json({ success: false, message: 'Full name is required' });
    }

    const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim() : null;
    const cleanMobile = mobile && typeof mobile === 'string' && mobile.trim() ? mobile.trim() : null;

    if (cleanEmail || cleanMobile) {
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ...(cleanMobile ? [{ mobile: cleanMobile }] : [])
          ]
        }
      });
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'User with this email or mobile already exists' });
      }
    }

    let hashedPassword = undefined;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    let stationConnect = undefined;
    if (stationId && typeof stationId === 'string' && stationId.trim()) {
      stationConnect = { connect: { id: stationId.trim() } };
    }

    const user = await prisma.user.create({
      data: {
        email: cleanEmail,
        mobile: cleanMobile,
        password: hashedPassword,
        role: 'WORKER',
        status: status ? status.toUpperCase() : 'ACTIVE',
        workerProfile: {
          create: {
            fullName: workerFullName,
            shift: shift || 'Morning',
            ...(stationConnect && { station: stationConnect })
          }
        }
      },
      include: {
        workerProfile: {
          include: {
            station: true
          }
        }
      }
    });

    const fullWorker = await prisma.workerProfile.findUnique({
      where: { userId: user.id },
      include: { user: true, station: true }
    });

    res.status(201).json({ success: true, data: fullWorker });
  } catch (error) {
    next(error);
  }
};

export const getWorkerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const worker = await prisma.workerProfile.findUnique({
      where: { id },
      include: { user: true, station: true }
    });

    if (!worker || worker.isDeleted) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    res.status(200).json({ success: true, data: worker });
  } catch (error) {
    next(error);
  }
};

export const updateWorker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const workerFullName = req.body.fullName !== undefined ? req.body.fullName : req.body.name;
    const email = req.body.email;
    const mobile = req.body.mobile !== undefined ? req.body.mobile : req.body.phone;
    const { password, shift, stationId, status } = req.body;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim() : (email === null ? null : undefined);
    const cleanMobile = mobile && typeof mobile === 'string' && mobile.trim() ? mobile.trim() : (mobile === null ? null : undefined);

    // Check for email or mobile uniqueness excluding current user
    if (cleanEmail || cleanMobile) {
      const existingUser = await prisma.user.findFirst({
        where: {
          id: { not: workerProfile.userId },
          OR: [
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ...(cleanMobile ? [{ mobile: cleanMobile }] : [])
          ]
        }
      });
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'Email or mobile already in use by another user' });
      }
    }

    let hashedPassword = undefined;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    let stationUpdate = undefined;
    if (stationId !== undefined) {
      if (stationId && typeof stationId === 'string' && stationId.trim()) {
        stationUpdate = { connect: { id: stationId.trim() } };
      } else {
        stationUpdate = { disconnect: true };
      }
    }

    const updatedWorker = await prisma.workerProfile.update({
      where: { id },
      data: {
        fullName: workerFullName !== undefined ? workerFullName : undefined,
        shift: shift !== undefined ? shift : undefined,
        ...(stationUpdate !== undefined && { station: stationUpdate }),
        user: {
          update: {
            ...(cleanEmail !== undefined && { email: cleanEmail }),
            ...(cleanMobile !== undefined && { mobile: cleanMobile }),
            ...(hashedPassword && { password: hashedPassword }),
            ...(status && { status: status.toUpperCase() })
          }
        }
      },
      include: { user: true, station: true }
    });

    res.status(200).json({ success: true, data: updatedWorker });
  } catch (error) {
    console.error("Error in updateWorker:", error);
    next(error);
  }
};

export const deleteWorker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { id }
    });

    if (!workerProfile || workerProfile.isDeleted) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    await prisma.$transaction([
      prisma.workerProfile.update({
        where: { id },
        data: { isDeleted: true }
      }),
      prisma.user.update({
        where: { id: workerProfile.userId },
        data: { status: 'INACTIVE' }
      })
    ]);

    res.status(200).json({ success: true, message: 'Worker deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const transactions = await prisma.transaction.findMany({
      include: { customer: true, worker: true, station: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });
    
    const total = await prisma.transaction.count();

    res.status(200).json({ 
      success: true, 
      data: transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getGroups = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groups = await prisma.group.findMany({
      where: { isDeleted: false },
      include: {
        customers: {
          where: { isDeleted: false },
          select: {
            id: true,
            transactions: {
              where: { status: 'COMPLETED' },
              select: {
                id: true,
                amount: true,
                discountAmount: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const totalGroupedCustomers = await prisma.customerProfile.count({
      where: { isDeleted: false, groupId: { not: null } }
    });

    let overallDiscountGenerated = 0;

    const data = groups.map(g => {
      let groupTransactions = 0;
      let groupDiscount = 0;
      for (const customer of g.customers) {
        groupTransactions += customer.transactions.length;
        for (const txn of customer.transactions) {
          groupDiscount += (txn.discountAmount || 0);
        }
      }
      overallDiscountGenerated += groupDiscount;

      return {
        id: g.id,
        name: g.name,
        discountPercent: g.discountPercent,
        description: g.description,
        active: g.active,
        isDefault: g.isDefault,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        customersCount: g.customers.length,
        transactionsCount: groupTransactions,
        discountGenerated: groupDiscount,
      };
    });

    res.status(200).json({
      success: true,
      data,
      stats: {
        totalGroups: groups.length,
        activeGroups: groups.filter(g => g.active).length,
        groupedCustomers: totalGroupedCustomers,
        discountGenerated: overallDiscountGenerated,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getGroupsSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [totalGroups, activeGroups, totalGroupedCustomers, groupsWithTxns] = await Promise.all([
      prisma.group.count({ where: { isDeleted: false } }),
      prisma.group.count({ where: { isDeleted: false, active: true } }),
      prisma.customerProfile.count({ where: { isDeleted: false, groupId: { not: null } } }),
      prisma.group.findMany({
        where: { isDeleted: false },
        select: {
          customers: {
            where: { isDeleted: false },
            select: {
              transactions: {
                where: { status: 'COMPLETED' },
                select: { discountAmount: true }
              }
            }
          }
        }
      })
    ]);

    let overallDiscountGenerated = 0;
    for (const g of groupsWithTxns) {
      for (const c of g.customers) {
        for (const t of c.transactions) {
          overallDiscountGenerated += (t.discountAmount || 0);
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        totalGroups,
        activeGroups,
        groupedCustomers: totalGroupedCustomers,
        discountGenerated: overallDiscountGenerated,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notifications = await prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { adminProfile: true }
    });

    if (!user || !user.adminProfile) {
      return res.status(404).json({ success: false, message: 'Admin profile not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        name: user.adminProfile.fullName,
        email: user.email ?? '',
        phone: user.mobile ?? '',
        role: user.role,
        location: user.adminProfile.location ?? '',
        joinedAt: (user as any).createdAt ?? new Date().toISOString(),
        initials: user.adminProfile.fullName
          .split(' ')
          .map((n: string) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2),
      }
    });
  } catch (error) {
    next(error);
  }
};

export const createCustomer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerFullName = req.body.fullName || req.body.name;
      const email = req.body.email;
      const mobile = req.body.mobile || req.body.phone;
      const { password, vehicle, groupId, address, status } = req.body;
      if (!customerFullName) return res.status(400).json({ success: false, message: 'Full name is required' });

      const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim() : null;
      const cleanMobile = mobile && typeof mobile === 'string' && mobile.trim() ? mobile.trim() : null;

      if (cleanEmail || cleanMobile) {
        const existing = await prisma.user.findFirst({
          where: { OR: [...(cleanEmail ? [{ email: cleanEmail }] : []), ...(cleanMobile ? [{ mobile: cleanMobile }] : [])] }
        });
        if (existing) {
          if (cleanEmail && existing.email === cleanEmail) return res.status(409).json({ success: false, message: 'Email is already in use.' });
          if (cleanMobile && existing.mobile === cleanMobile) return res.status(409).json({ success: false, message: 'Phone number is already in use.' });
        }
      }

      const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;
      const userStatus = status ? status.toUpperCase() : 'ACTIVE';

      let groupConnect = undefined;
      if (groupId && typeof groupId === 'string' && groupId.trim()) {
        groupConnect = { connect: { id: groupId.trim() } };
      }

      const user = await prisma.user.create({
        data: {
          email: cleanEmail, mobile: cleanMobile, password: hashedPassword, role: 'CUSTOMER', status: userStatus as any,
          customerProfile: {
            create: {
              fullName: customerFullName,
              vehicle: vehicle !== undefined ? vehicle : undefined,
              address: address !== undefined ? address : undefined,
              ...(groupConnect && { group: groupConnect })
            }
          }
        },
        include: { customerProfile: { include: { group: true, user: true } } }
      });
      
      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId: user.id },
        include: { user: true, group: true }
      });

      res.status(201).json({ success: true, data: customerProfile });
    } catch (error) { next(error); }
  };

export const updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const customerFullName = req.body.fullName !== undefined ? req.body.fullName : req.body.name;
      const email = req.body.email;
      const mobile = req.body.mobile !== undefined ? req.body.mobile : req.body.phone;
      const { password, vehicle, groupId, address, status } = req.body;

      const profile = await prisma.customerProfile.findUnique({ where: { id }, include: { user: true } });
      if (!profile) return res.status(404).json({ success: false, message: 'Customer not found' });

      const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim() : (email === null ? null : undefined);
      const cleanMobile = mobile && typeof mobile === 'string' && mobile.trim() ? mobile.trim() : (mobile === null ? null : undefined);

      if (cleanEmail || cleanMobile) {
        const existing = await prisma.user.findFirst({
          where: { 
            id: { not: profile.userId },
            OR: [...(cleanEmail ? [{ email: cleanEmail }] : []), ...(cleanMobile ? [{ mobile: cleanMobile }] : [])] 
          }
        });
        if (existing) {
          if (cleanEmail && existing.email === cleanEmail) return res.status(409).json({ success: false, message: 'Email is already in use.' });
          if (cleanMobile && existing.mobile === cleanMobile) return res.status(409).json({ success: false, message: 'Phone number is already in use.' });
        }
      }

      const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;
      const userStatus = status ? status.toUpperCase() : undefined;

      let groupUpdate = undefined;
      if (groupId !== undefined) {
        if (groupId && typeof groupId === 'string' && groupId.trim()) {
          groupUpdate = { connect: { id: groupId.trim() } };
        } else {
          groupUpdate = { disconnect: true };
        }
      }

      const updated = await prisma.customerProfile.update({
        where: { id },
        data: {
          fullName: customerFullName !== undefined ? customerFullName : undefined,
          vehicle: vehicle !== undefined ? vehicle : undefined,
          address: address !== undefined ? address : undefined,
          ...(groupUpdate !== undefined && { group: groupUpdate }),
          user: { update: { ...(cleanEmail !== undefined && { email: cleanEmail }), ...(cleanMobile !== undefined && { mobile: cleanMobile }), ...(hashedPassword && { password: hashedPassword }), ...(userStatus && { status: userStatus as any }) } }
        },
        include: { user: true, group: true }
      });
      res.status(200).json({ success: true, data: updated });
    } catch (error) { next(error); }
  };

export const deleteCustomer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const profile = await prisma.customerProfile.findUnique({ where: { id } });
      if (!profile) return res.status(404).json({ success: false, message: 'Customer not found' });
      await prisma.$transaction([
        prisma.customerProfile.update({ where: { id }, data: { isDeleted: true } }),
        prisma.user.update({ where: { id: profile.userId }, data: { status: 'INACTIVE' } })
      ]);
      res.status(200).json({ success: true, message: 'Customer deleted' });
    } catch (error) { next(error); }
  };

export const createGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, discountPercent, description, isDefault } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Group name is required' });
    }
    const parsedDiscount = parseFloat(discountPercent);
    if (isNaN(parsedDiscount) || parsedDiscount < 0 || parsedDiscount > 100) {
      return res.status(400).json({ success: false, message: 'Discount percentage must be between 0 and 100' });
    }
    const group = await prisma.group.create({
      data: {
        name: name.trim(),
        discountPercent: parsedDiscount,
        description: description ? description.trim() : null,
        isDefault: Boolean(isDefault),
      }
    });
    res.status(201).json({
      success: true,
      data: {
        ...group,
        customersCount: 0,
        transactionsCount: 0,
        discountGenerated: 0,
      }
    });
  } catch (error) { next(error); }
};

export const updateGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { name, discountPercent, description, isDefault, active } = req.body;
    const data: any = {};
    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Group name is required' });
      }
      data.name = name.trim();
    }
    if (discountPercent !== undefined) {
      const parsedDiscount = parseFloat(discountPercent);
      if (isNaN(parsedDiscount) || parsedDiscount < 0 || parsedDiscount > 100) {
        return res.status(400).json({ success: false, message: 'Discount percentage must be between 0 and 100' });
      }
      data.discountPercent = parsedDiscount;
    }
    if (description !== undefined) {
      data.description = description ? description.trim() : null;
    }
    if (isDefault !== undefined) {
      data.isDefault = Boolean(isDefault);
    }
    if (active !== undefined) {
      data.active = Boolean(active);
    }
    const group = await prisma.group.update({
      where: { id },
      data,
      include: {
        customers: {
          where: { isDeleted: false },
          select: {
            id: true,
            transactions: {
              where: { status: 'COMPLETED' },
              select: { amount: true, discountAmount: true }
            }
          }
        }
      }
    });

    let groupTransactions = 0;
    let groupDiscount = 0;
    for (const customer of group.customers) {
      groupTransactions += customer.transactions.length;
      for (const txn of customer.transactions) {
        groupDiscount += (txn.discountAmount || 0);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        id: group.id,
        name: group.name,
        discountPercent: group.discountPercent,
        description: group.description,
        active: group.active,
        isDefault: group.isDefault,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        customersCount: group.customers.length,
        transactionsCount: groupTransactions,
        discountGenerated: groupDiscount,
      }
    });
  } catch (error) { next(error); }
};

export const toggleGroupActive = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const group = await prisma.group.findUnique({
      where: { id },
      include: {
        customers: {
          where: { isDeleted: false },
          select: {
            id: true,
            transactions: {
              where: { status: 'COMPLETED' },
              select: { amount: true, discountAmount: true }
            }
          }
        }
      }
    });
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    const updated = await prisma.group.update({ where: { id }, data: { active: !group.active } });

    let groupTransactions = 0;
    let groupDiscount = 0;
    for (const customer of group.customers) {
      groupTransactions += customer.transactions.length;
      for (const txn of customer.transactions) {
        groupDiscount += (txn.discountAmount || 0);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...updated,
        customersCount: group.customers.length,
        transactionsCount: groupTransactions,
        discountGenerated: groupDiscount,
      }
    });
  } catch (error) { next(error); }
};

export const deleteGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    // Safely unassign customers from this group first
    await prisma.customerProfile.updateMany({
      where: { groupId: id },
      data: { groupId: null }
    });
    // Soft delete: update isDeleted to true in database
    await prisma.group.update({
      where: { id },
      data: { isDeleted: true, active: false }
    });
    res.status(200).json({ success: true, message: 'Group deleted' });
  } catch (error) { next(error); }
};

export const markNotificationRead = async (req: any, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;
    // ensure notification belongs to user or is global
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found' });
    if (notif.userId && notif.userId !== userId) return res.status(403).json({ success: false, message: 'Unauthorized' });

    const updated = await prisma.notification.update({ where: { id }, data: { read: true } });
    res.status(200).json({ success: true, data: updated });
  } catch (error) { next(error); }
};

export const markAllNotificationsRead = async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    // update all for this user, OR global if allowed, but safest is to scope to user
    await prisma.notification.updateMany({ 
      where: { OR: [{ userId }, { userId: null }] }, 
      data: { read: true } 
    });
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) { next(error); }
};
