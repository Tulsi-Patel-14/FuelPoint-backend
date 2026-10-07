import { Router } from 'express';
import { 
  requestOtp, 
  verifyOtpAndLogin, 
  scanCustomerQR, 
  verifyCustomerOtp,
  submitTransaction, 
  getTodayTransactions,
  getWorkerProfile,
  getMonthlySummary,
  getYearlySummary,
  getTransactions,
  getDashboardData,
  getTransactionById
} from './worker_app.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { roleMiddleware } from '../../middlewares/role.middleware';
import { Role } from '@prisma/client';

const router = Router();

// ==========================================
// 🔓 PUBLIC ROUTES (No Token Required)
// ==========================================

// 1. Request OTP for Login
router.post('/auth/request-otp', requestOtp);

// 2. Verify OTP & Get Token
router.post('/auth/verify-otp', verifyOtpAndLogin);


// ==========================================
// 🔒 PROTECTED ROUTES (Worker Token Required)
// ==========================================
// Apply authentication & role verification for all routes below
router.use(authMiddleware);
router.use(roleMiddleware([Role.WORKER]));

// 3. Scan Customer QR
router.post('/qr/scan', scanCustomerQR);

// Verify Customer OTP
router.post('/qr/verify-otp', verifyCustomerOtp);

// 4. Submit Fuel Transaction
router.post('/transactions/submit', submitTransaction);

// 5. View Today's Transactions
router.get('/transactions/today', getTodayTransactions);

// 6. View Monthly & Yearly Summaries
router.get('/transactions/monthly-summary', getMonthlySummary);
router.get('/transactions/yearly-summary', getYearlySummary);

// 7. Get Generic Transactions List
router.get('/transactions', getTransactions);

// 8. Get Single Transaction Details
router.get('/transactions/details/:id', getTransactionById);

// 9. Unified Dashboard
router.get('/transactions/dashboard', getDashboardData);

// 9. Get Profile
router.get('/profile', getWorkerProfile);

export default router;
