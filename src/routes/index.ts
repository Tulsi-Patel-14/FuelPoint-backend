import { Router } from 'express';
import customerRoutes from '../modules/customer/customer.routes';
import workerRoutes from '../modules/worker/worker.routes';
import adminRoutes from '../modules/admin/admin.routes';

const router = Router();

router.use('/customer', customerRoutes);
router.use('/worker', workerRoutes);
router.use('/admin', adminRoutes);

export default router;

