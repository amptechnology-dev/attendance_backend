import { Router } from 'express';
const router = Router();
import {
  createMonth,
  updateMonth,
  setCurrentMonth,
  getMonths,
  getMonthById,
  getCurrentMonth,
} from '../../controllers/admin/month.controller.js';
import { monthValidationSchema, updateMonthValidationSchema } from '../../validations/month.validator.js';
import validateBody from '../../middlewares/validator.middleware.js';

router.route('/create').post(validateBody(monthValidationSchema), createMonth);
router.route('/update/:id').put(validateBody(updateMonthValidationSchema), updateMonth);
router.route('/set-current/:id').put(setCurrentMonth);
router.route('/get').get(getMonths);
router.route('/get/:id').get(getMonthById);
router.route('/current').get(getCurrentMonth);

export default router;
