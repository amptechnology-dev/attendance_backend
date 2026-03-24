import { Router } from 'express';
import { getLoginLogs } from '../../controllers/admin/logs.controller.js';
import { adminAuth } from '../../middlewares/auth.middleware.js';

const router = Router();
router.use(adminAuth);
router.route('/login').get(getLoginLogs);

export default router;
