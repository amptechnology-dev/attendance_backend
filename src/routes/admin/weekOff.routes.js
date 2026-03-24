import { Router } from 'express';
const router = Router();
import {
  createWeekOff,
  updateWeekOff,
  deleteWeekOff,
  getWeekOffs,
  getWeekOffByDate,
  getWeekOffByDepartment,
  getWeekOffsByMonth,
} from '../../controllers/weekOff.controller.js';
import { hasPermission } from '../../middlewares/auth.middleware.js';
import { permissions } from '../../config/constants.js';

router.route('/create').post(hasPermission(permissions.MANAGE_OFFDAYS), createWeekOff);
router.route('/update/:id').put(hasPermission(permissions.MANAGE_OFFDAYS), updateWeekOff);
router.route('/delete/:id').delete(hasPermission(permissions.MANAGE_OFFDAYS), deleteWeekOff);
router.use(hasPermission(permissions.VIEW_OFFDAYS));
router.route('/get').get(getWeekOffs);
router.route('/get-by-date/:date').get(getWeekOffByDate);
router.route('/get-by-department/:department').get(getWeekOffByDepartment);
router.route('/get-by-month/:month').get(getWeekOffsByMonth);

export default router;
