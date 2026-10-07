import { Router } from 'express';
import { 
  register,
  requestOtp,
  verifyOtpAndLogin, 
  getProfile, 
  generateQR, 
  getQRStatus, 
  getStations, 
  getDashboardData,
  getTodayTransactions,
  getMonthlySummary,
  getYearlySummary,
  getTransactions,
  getTransactionById
} from './customer_app.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { roleMiddleware } from '../../middlewares/role.middleware';
import { Role } from '@prisma/client';

const router = Router();

// 1. Auth
router.post('/auth/register', register);
router.post('/auth/request-otp', requestOtp);
router.post('/auth/verify-otp', verifyOtpAndLogin);

// Protected routes
router.use(authMiddleware);
router.use(roleMiddleware([Role.CUSTOMER]));

// 2. Profile
router.get('/profile', getProfile);

// 3. QR & Stations
router.post('/qr/generate', generateQR);
router.get('/qr/status/:token', getQRStatus);
router.get('/stations', getStations);

// 4. Summaries & Dashboards
router.get('/dashboard', getDashboardData); // e.g. ?period=today
router.get('/transactions/today', getTodayTransactions);
router.get('/transactions/monthly-summary', getMonthlySummary);
router.get('/transactions/yearly-summary', getYearlySummary);

// 5. General Transactions
router.get('/transactions', getTransactions); // e.g. ?filterType=ALL
router.get('/transactions/:id', getTransactionById);

export default router;
