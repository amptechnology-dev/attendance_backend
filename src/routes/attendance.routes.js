import { Router } from 'express';
const router = Router();
import {
  getAttendanceLogs,
  getAttendanceLogsByMonth,
  getTodayAttendance,
  putHrAdjustment,
  getAllHolidayLeave,
  calculateAttendanceByDate,
  assignOffDayWork,
  getAllOffDayWorkAssigned,
} from '../controllers/attendance.controller.js';
import { adminAuth, hasPermission } from '../middlewares/auth.middleware.js';
import { permissions } from '../config/constants.js';

router.use(adminAuth);
router.route('/get').get(hasPermission(permissions.VIEW_ATTENDANCE), getAttendanceLogs);
router.route('/get-by-month').get(hasPermission(permissions.VIEW_ATTENDANCE), getAttendanceLogsByMonth);
router.route('/get-today').get(hasPermission(permissions.VIEW_ATTENDANCE), getTodayAttendance);
router.route('/hr-adjustment/:id').put(hasPermission(permissions.MANAGE_ATTENDANCE), putHrAdjustment);
router.route('/holiday-leave/get').get(getAllHolidayLeave);
router
  .route('/calculate-by-date/:date')
  .get(hasPermission(permissions.CALCULATE_ATTENDANCE), calculateAttendanceByDate);
router.route('/off-day-work/assign').post(hasPermission(permissions.MANAGE_ATTENDANCE), assignOffDayWork);
router.route('/off-day-work/get').get(hasPermission(permissions.VIEW_ATTENDANCE), getAllOffDayWorkAssigned);

export default router;
