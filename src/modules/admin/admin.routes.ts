import { Router } from 'express';
import { 
  login, getDashboard, getProfile,
  getCustomers, createCustomer, updateCustomer, deleteCustomer,
  getWorkers, createWorker, getWorkerById, updateWorker, deleteWorker,
  getTransactions, 
  getGroups, createGroup, updateGroup, toggleGroupActive, deleteGroup,
  getNotifications, markNotificationRead, markAllNotificationsRead
} from './admin.controller';
import {
  getStations, getStationById, createStation, updateStation, deleteStation,
  generateQR, validateQR, scanQR,
  getReportSummary
} from './extra.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { roleMiddleware } from '../../middlewares/role.middleware';
import { Role } from '@prisma/client';

const router = Router();

router.post('/auth/login', login);

router.use(authMiddleware);
router.use(roleMiddleware([Role.ADMIN, Role.SUPER_ADMIN]));

router.get('/dashboard', getDashboard);
router.get('/profile', getProfile);

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

export default router;
