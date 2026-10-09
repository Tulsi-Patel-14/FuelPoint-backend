import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getStations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const station = await prisma.station.findFirst();
    if (!station) {
      return res.status(200).json({
        success: true,
        data: null
      });
    }
    return res.status(200).json({
      success: true,
      data: {
        stationName: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        radiusMeters: station.radiusMeters
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getStationById = async (req: Request, res: Response, next: NextFunction) => { res.status(501).json({ message: 'Not Implemented' }); };
export const createStation = async (req: Request, res: Response, next: NextFunction) => { res.status(501).json({ message: 'Not Implemented' }); };

export const updateStation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stationName, latitude, longitude, radiusMeters } = req.body;

    if (!stationName || typeof stationName !== 'string' || !stationName.trim()) {
      return res.status(400).json({ success: false, message: 'Station name is required.' });
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    const radius = Number(radiusMeters);
    
    if (isNaN(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ success: false, message: 'Valid latitude is required (-90 to 90).' });
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, message: 'Valid longitude is required (-180 to 180).' });
    }
    if (isNaN(radius) || radius <= 0) {
      return res.status(400).json({ success: false, message: 'Valid positive geofence radius in meters is required.' });
    }

    let station = await prisma.station.findFirst();
    
    if (station) {
      station = await prisma.station.update({
        where: { id: station.id },
        data: {
          name: stationName.trim(),
          latitude: lat,
          longitude: lng,
          radiusMeters: radius
        }
      });
    } else {
      station = await prisma.station.create({
        data: {
          name: stationName.trim(),
          latitude: lat,
          longitude: lng,
          radiusMeters: radius
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Station settings saved successfully.',
      data: {
        stationName: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        radiusMeters: station.radiusMeters
      }
    });
  } catch (error) {
    next(error);
  }
};

export const deleteStation = async (req: Request, res: Response, next: NextFunction) => { res.status(501).json({ message: 'Not Implemented' }); };

export const generateQR = async (req: Request, res: Response, next: NextFunction) => { res.status(501).json({ message: 'Not Implemented' }); };
export const validateQR = async (req: Request, res: Response, next: NextFunction) => { res.status(501).json({ message: 'Not Implemented' }); };
export const scanQR = async (req: Request, res: Response, next: NextFunction) => { res.status(501).json({ message: 'Not Implemented' }); };
