import { Router } from 'express';
import { login, getProfile, generateQR, getStations, getQRStatus, getTransactions } from './customer.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { roleMiddleware } from '../../middlewares/role.middleware';
import { Role } from '@prisma/client';

const router = Router();

// Auth
router.post('/auth/login', login);

// Protected routes
router.use(authMiddleware);
router.use(roleMiddleware([Role.CUSTOMER]));

router.get('/profile', getProfile);
router.post('/qr/generate', generateQR);
router.get('/qr/status/:token', getQRStatus);
router.get('/stations', getStations);
router.get('/transactions', getTransactions);

export default router;

