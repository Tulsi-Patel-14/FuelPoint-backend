import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateTokens } from '../../utils/jwt';
import crypto from 'crypto';

const prisma = new PrismaClient();

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mobile, otp } = req.body;
    
    if (otp !== '1234') {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    let user = await prisma.user.findUnique({
      where: { mobile },
      include: { customerProfile: true }
    });

    if (!user) {
      const defaultGroup = await prisma.group.findFirst({ where: { isDefault: true, isDeleted: false } });
      user = await prisma.user.create({
        data: {
          mobile,
          role: 'CUSTOMER',
          customerProfile: {
            create: {
              fullName: 'New Customer',
              groupId: defaultGroup?.id
            }
          }
        },
        include: { customerProfile: true }
      });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token: accessToken,
        refreshToken,
        customer: user.customerProfile
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
      include: {
        customerProfile: {
          include: {
            transactions: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const profile = user.customerProfile!;
    
    const totalVisits = profile.transactions.length;
    const totalFuelLiters = profile.transactions.reduce((acc, tx) => acc + tx.litres, 0);
    const totalSpent = profile.transactions.reduce((acc, tx) => acc + tx.finalAmount, 0);

    res.status(200).json({
      success: true,
      data: {
        ...profile,
        stats: {
          totalVisits,
          totalFuelLiters,
          totalSpent
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

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
        expiresAt: qrSession.expiresAt.getTime()
      }
    });
  } catch (error) {
    next(error);
  }
};

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

export const getQRStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params.token as string;
    const qrSession = await prisma.qRSession.findUnique({
      where: { token }
    });

    if (!qrSession) {
      return res.status(404).json({ success: false, message: 'QR not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        status: qrSession.status,
        expiresAt: qrSession.expiresAt.getTime()
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.userId;
    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });

    const transactions = await prisma.transaction.findMany({
      where: { customerId: profile.id },
      orderBy: { createdAt: 'desc' },
      include: { station: true }
    });

    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    next(error);
  }
};
