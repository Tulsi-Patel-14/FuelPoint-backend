import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './error.middleware';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
  };
}

export const authMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'Unauthorized');
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_ACCESS_SECRET || 'super-secret-access-key-for-petrol-pump';
    const decoded = jwt.verify(token, secret) as any;

    req.user = {
      userId: decoded.sub,
      role: decoded.role,
    };

    next();
  } catch (error) {
    console.error('JWT Error:', error);
    next(new AppError(401, 'Unauthorized'));
  }
};

