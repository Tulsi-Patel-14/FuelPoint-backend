import { Router } from 'express';
import workerRoutes from '../modules/worker/worker.routes';
import adminRoutes from '../modules/admin/admin.routes';
import workerAppRoutes from '../modules/worker_app/worker_app.routes';
import customerAppRoutes from '../modules/customer_app/customer_app.routes';

const router = Router();

router.use('/customer-app', customerAppRoutes); // New customer app module
router.use('/worker', workerRoutes);
router.use('/admin', adminRoutes);
router.use('/worker-app', workerAppRoutes);

export default router;

