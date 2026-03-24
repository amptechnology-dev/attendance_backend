import { Router } from 'express';
const router = Router();
import {
  createHoliday,
  deleteHoliday,
  getHolidays,
  getHolidayByDate,
  getHolidaysByDepartment,
  getHolidaysByFinancialYear,
  getHolidaysByMonth,
} from '../../controllers/holiday.controller.js';
import validateBody from '../../middlewares/validator.middleware.js';
import { holidayValidationSchema } from '../../validations/holiday.validator.js';
import { hasPermission } from '../../middlewares/auth.middleware.js';
import { permissions } from '../../config/constants.js';

router
  .route('/create')
  .post(hasPermission(permissions.MANAGE_OFFDAYS), validateBody(holidayValidationSchema), createHoliday);
router.route('/delete/:id').delete(hasPermission(permissions.MANAGE_OFFDAYS), deleteHoliday);
router.use(hasPermission(permissions.VIEW_OFFDAYS));
router.route('/get').get(getHolidays);
router.route('/get-by-date/:date').get(getHolidayByDate);
router.route('/get-by-department/:department').get(getHolidaysByDepartment);
router.route('/get-by-financial-year/:financial_year').get(getHolidaysByFinancialYear);
router.route('/get-by-month/:month').get(getHolidaysByMonth);

export default router;
