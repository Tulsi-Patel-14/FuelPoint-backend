import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateTokens } from '../../utils/jwt';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { identifier, password } = req.body;
    
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { mobile: identifier }],
        role: 'WORKER'
      },
      include: { workerProfile: true }
    });

    if (!user || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, message: 'Account is pending approval or suspended' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    res.status(200).json({
      success: true,
      data: {
        token: accessToken,
        user: user.workerProfile
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { workerProfile: true }
    });

    res.status(200).json({ success: true, data: user?.workerProfile });
  } catch (error) {
    next(error);
  }
};

export const scanQR = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { qrToken } = req.body;
    
    const qrSession = await prisma.qRSession.findUnique({
      where: { token: qrToken },
      include: { 
        customer: {
          include: { group: true }
        }
      }
    });

    if (!qrSession) {
      return res.status(400).json({ success: false, message: 'Invalid QR' });
    }

    if (qrSession.status !== 'ACTIVE' || qrSession.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'QR_EXPIRED' });
    }

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
          customerId: qrSession.customer.id,
          fullName: qrSession.customer.fullName,
          group: qrSession.customer.group
        },
        discountPercentage: qrSession.customer.group?.discountPercent || 0,
        expiresAt: new Date(Date.now() + 5 * 60000).toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
};

export const redeemTransaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const { qrSessionId, customerId, fuelAmount, petrolPumpId, idempotencyKey } = req.body;

    if (idempotencyKey) {
      const existingTx = await prisma.transaction.findFirst({
        where: { idempotencyKey }
      });
      if (existingTx) {
        return res.status(200).json({ success: true, data: { transaction: existingTx } });
      }
    }

    const worker = await prisma.workerProfile.findUnique({ where: { userId } });
    const qrSession = await prisma.qRSession.findUnique({ where: { id: qrSessionId } });
    const customer = await prisma.customerProfile.findUnique({ where: { id: customerId }, include: { group: true } });

    if (!worker || !qrSession || !customer) {
      return res.status(400).json({ success: false, message: 'Invalid reference data' });
    }

    if (qrSession.status === 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'QR_ALREADY_USED' });
    }

    const discountPercent = customer.group?.discountPercent || 0;
    const discountAmount = (fuelAmount * discountPercent) / 100;
    const finalAmount = fuelAmount - discountAmount;
    const litres = fuelAmount / 100;

    const transaction = await prisma.$transaction(async (tx) => {
      const newTx = await tx.transaction.create({
        data: {
          customerId: customer.id,
          workerId: worker.id,
          stationId: petrolPumpId || worker.stationId || 'default-station',
          fuelType: 'Petrol',
          amount: fuelAmount,
          discountPercent,
          discountAmount,
          finalAmount,
          litres,
          idempotencyKey
        }
      });

      await tx.qRSession.update({
        where: { id: qrSession.id },
        data: { status: 'COMPLETED', consumedAt: new Date() }
      });

      return newTx;
    });

    res.status(200).json({
      success: true,
      data: { transaction }
    });
  } catch (error) {
    next(error);
  }
};

export const cancelTransaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const transaction = await prisma.transaction.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });
    res.status(200).json({ success: true, data: transaction });
  } catch (error) {
    next(error);
  }
};

export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const worker = await prisma.workerProfile.findUnique({ where: { userId } });
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found' });

    const transactions = await prisma.transaction.findMany({
      where: { workerId: worker.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { customer: true }
    });
    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    next(error);
  }
};

export const getTodaySummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const worker = await prisma.workerProfile.findUnique({ where: { userId } });
    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = await prisma.transaction.aggregate({
      where: {
        workerId: worker.id,
        createdAt: { gte: today },
        status: 'COMPLETED'
      },
      _count: { id: true },
      _sum: { amount: true, discountAmount: true, finalAmount: true }
    });

    res.status(200).json({
      success: true,
      data: {
        transactionCount: stats._count.id,
        totalFuelAmount: stats._sum.amount || 0,
        totalDiscountAmount: stats._sum.discountAmount || 0,
        totalFinalAmount: stats._sum.finalAmount || 0
      }
    });
  } catch (error) {
    next(error);
  }
};
