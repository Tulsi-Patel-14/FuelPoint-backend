import { Router } from 'express';
import { 
<<<<<<< Updated upstream
  login, forgotPassword, resetPassword, verifyResetToken, getDashboard, getProfile, updateProfile, changePassword,
=======
  login, getDashboard, getProfile, updateProfile, changePassword,
>>>>>>> Stashed changes
  getCustomers, createCustomer, updateCustomer, deleteCustomer,
  getWorkers, createWorker, getWorkerById, updateWorker, deleteWorker,
  getTransactions, 
  getGroups, createGroup, updateGroup, toggleGroupActive, deleteGroup,
<<<<<<< Updated upstream
  getNotifications, markNotificationRead, markAllNotificationsRead, uploadProfileImage, globalSearch
=======
  getNotifications, markNotificationRead, markAllNotificationsRead, uploadProfileImage
>>>>>>> Stashed changes
} from './admin.controller';
import {
  getStations, getStationById, createStation, updateStation, deleteStation,
  generateQR, validateQR, scanQR
} from './extra.controller';
import {
  getReportSummary,
  getReportData,
  exportReport
} from './report.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { roleMiddleware } from '../../middlewares/role.middleware';
import { Role } from '@prisma/client';

const router = Router();

router.post('/auth/login', login);
router.post('/auth/forgot-password', forgotPassword);
router.post('/auth/reset-password', resetPassword);
router.get('/auth/verify-reset-token', verifyResetToken);
router.post('/auth/verify-reset-token', verifyResetToken);

router.use(authMiddleware);
router.use(roleMiddleware([Role.ADMIN, Role.SUPER_ADMIN]));

import multer from 'multer';
import path from 'path';

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(process.cwd(), 'public/uploads'))
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
});
const upload = multer({ storage: storage });

router.get('/dashboard', getDashboard);
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.patch('/profile', updateProfile);
router.patch('/profile/password', changePassword);
router.put('/profile/password', changePassword);
router.post('/profile/upload', upload.single('profileImage'), uploadProfileImage);
<<<<<<< Updated upstream

router.get('/search', globalSearch);
=======
>>>>>>> Stashed changes

// Customers
router.get('/customers', getCustomers);
router.post('/customers', createCustomer);
router.put('/customers/:id', updateCustomer);
router.delete('/customers/:id', deleteCustomer);

// Workers
router.get('/workers', getWorkers);
router.post('/workers', createWorker);
router.get('/workers/:id', getWorkerById);
router.put('/workers/:id', updateWorker);
router.delete('/workers/:id', deleteWorker);

// Transactions
router.get('/transactions', getTransactions);

// Groups
router.get('/groups', getGroups);
router.post('/groups', createGroup);
router.put('/groups/:id', updateGroup);
router.patch('/groups/:id/toggle', toggleGroupActive);
router.delete('/groups/:id', deleteGroup);

// Notifications
router.get('/notifications', getNotifications);
router.patch('/notifications/:id/read', markNotificationRead);
router.post('/notifications/mark-all-read', markAllNotificationsRead);

// Stations
router.get('/stations', getStations);
router.get('/stations/:id', getStationById);
router.post('/stations', createStation);
router.put('/stations/:id', updateStation);
router.delete('/stations/:id', deleteStation);

// QR
router.post('/qr/generate', generateQR);
router.post('/qr/validate', validateQR);
router.post('/qr/scan', scanQR);

// Reports
router.get('/reports/summary', getReportSummary);
router.get('/reports/data', getReportData);
router.get('/reports/export', exportReport);

export default router;
