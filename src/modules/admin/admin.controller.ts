import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateTokens } from '../../utils/jwt';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

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

export const getDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const totalCustomers = await prisma.customerProfile.count();
    const totalWorkers = await prisma.workerProfile.count();
    
    const transactions = await prisma.transaction.aggregate({
      _count: { id: true },
      _sum: { amount: true, discountAmount: true }
    });

    res.status(200).json({
      success: true,
      data: {
        totalCustomers,
        totalWorkers,
        totalTransactions: transactions._count.id,
        totalRevenue: transactions._sum.amount || 0,
        totalDiscount: transactions._sum.discountAmount || 0,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search } = req.query;
    const whereClause = search ? { fullName: { contains: search as string, mode: 'insensitive' as any } } : {};

    const customers = await prisma.customerProfile.findMany({
      where: whereClause,
      include: { group: true }
    });
    res.status(200).json({ success: true, data: customers });
  } catch (error) {
    next(error);
  }
};

export const getWorkers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workers = await prisma.workerProfile.findMany({
      include: { user: true, station: true }
    });
    res.status(200).json({ success: true, data: workers });
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
    const groups = await prisma.group.findMany();
    res.status(200).json({ success: true, data: groups });
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

