import { Response, NextFunction } from 'express';
import { AppError } from './error.middleware';
import { AuthRequest } from './auth.middleware';

export const roleMiddleware = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'Forbidden: Insufficient privileges'));
    }
    next();
  };
};

