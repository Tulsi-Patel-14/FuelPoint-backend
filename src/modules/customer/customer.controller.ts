import prisma from '../../utils/prisma';
import { Request, Response, NextFunction } from 'express';

import { generateTokens } from '../../utils/jwt';
import crypto from 'crypto';
import { generateNextCustomerId, formatCustomerId } from '../../utils/idGenerator';
import { checkStationGeofence } from '../../utils/geofence';



const formatCustomerProfile = (profile: any) => {
  if (!profile) return profile;
  const customId = profile.customId || formatCustomerId(1);
  return {
    ...profile,
    customId,
    displayId: customId,
    customerCode: customId
  };
};

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
      const customId = await generateNextCustomerId(prisma);
      user = await prisma.user.create({
        data: {
          mobile,
          role: 'CUSTOMER',
          customerProfile: {
            create: {
              customId,
              fullName: 'New Customer',
              groupId: defaultGroup?.id
            }
          }
        },
        include: { customerProfile: true }
      });
    }

    if (!user) return res.status(500).json({ success: false, message: 'User not found' });
    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token: accessToken,
        refreshToken,
        customer: formatCustomerProfile(user.customerProfile)
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
    const { stationId, latitude, longitude, lat, lng } = req.body;

    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });

    // 1. Resolve Fuel Station
    let station = null;
    if (stationId) {
      station = await prisma.station.findUnique({ where: { id: stationId } });
    }
    if (!station) {
      station = await prisma.station.findFirst({ where: { active: true } });
    }

    if (!station) {
      return res.status(404).json({ success: false, message: 'Fuel station not found' });
    }

    // 2. Validate location and check station geofence radius
    const userLat = Number(latitude ?? lat);
    const userLng = Number(longitude ?? lng);
    const radiusMeters = station.radiusMeters || 150;
    const isInvalidCoords = isNaN(userLat) || isNaN(userLng) || (userLat === 0 && userLng === 0);

    const geofence = !isInvalidCoords
      ? checkStationGeofence(userLat, userLng, station.latitude, station.longitude, radiusMeters)
      : { isInside: false, distanceMeters: 0 };

    if (!geofence.isInside) {
      return res.status(400).json({
        success: false,
        message: 'You are not at the petrol pump premises!',
        distanceMeters: geofence.distanceMeters,
        radiusMeters
      });
    }

    // 4. Generate QR code if within premises
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 1000);

    const qrSession = await prisma.qRSession.create({
      data: {
        token,
        customerId: profile.id,
        stationId: station.id,
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
        expiresIn: 60
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
