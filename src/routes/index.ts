import { Router } from 'express';
import customerRoutes from '../modules/customer/customer.routes';
import workerRoutes from '../modules/worker/worker.routes';
import adminRoutes from '../modules/admin/admin.routes';
import workerAppRoutes from '../modules/worker_app/worker_app.routes';

const router = Router();

router.use('/customer', customerRoutes);
router.use('/customer-app', customerRoutes); // Added for Customer Mobile App
router.use('/worker', workerRoutes);
router.use('/admin', adminRoutes);
router.use('/worker-app', workerAppRoutes);

export default router;

