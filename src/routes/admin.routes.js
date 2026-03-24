import { Router } from 'express';
import { adminAuth } from '../middlewares/auth.middleware.js';
import profileRoutes from './admin/profile.route.js';
import departmentRoutes from './admin/department.routes.js';
import staffRoutes from './admin/staff.routes.js';
import dutyTimingRoutes from './admin/dutyTiming.routes.js';
import financialYearRoutes from './admin/financialYear.routes.js';
import monthRoutes from './admin/month.routes.js';
import holidayRoutes from './admin/holiday.routes.js';
import weekOffRoutes from './admin/weekOff.routes.js';
import reportRoutes from './admin/report.routes.js';
import { dashboradCounter } from '../controllers/admin/dashCount.controller.js';
import { getServerTime } from '../controllers/dateTime.controller.js';

const router = Router();
router.use(adminAuth);
router.route('/server-time').get(getServerTime);
router.use('/profile', profileRoutes);
router.use('/department', departmentRoutes);
router.use('/staff', staffRoutes);
router.use('/duty-timing', dutyTimingRoutes);
router.use('/financial-year', financialYearRoutes);
router.use('/month', monthRoutes);
router.use('/holiday', holidayRoutes);
router.use('/week-off', weekOffRoutes);
router.use('/report', reportRoutes);
router.route('/dashboard-counter').get(dashboradCounter);

export default router;
