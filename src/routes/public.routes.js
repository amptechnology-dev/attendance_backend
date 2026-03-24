import { Router } from 'express';
import { index } from '../controllers/public.controller.js';
import leaveRoutes from './leave.routes.js';

const router = Router();

router.route('/').get(index);
router.use('/leave', leaveRoutes);

export default router;
