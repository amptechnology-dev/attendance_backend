import { Router } from 'express';
import { getProfile } from '../controllers/staff.controller.js';
import { getHolidays } from '../controllers/holiday.controller.js';
import { getWeekOffs } from '../controllers/weekOff.controller.js';
import { staffAuth } from '../middlewares/auth.middleware.js';
import { getAttendanceByStaffId } from '../controllers/attendance.controller.js';

const router = Router();
router.route('/profile').get(staffAuth, getProfile);
router.route('/holidays').get(staffAuth, getHolidays);
router.route('/week-off').get(staffAuth, getWeekOffs);
router.route('/attendance').get(staffAuth, getAttendanceByStaffId);

export default router;
