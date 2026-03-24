import { Router } from 'express';
const router = Router();
import {
  createFinancialYear,
  setFinancialYear,
  getCurrentFinancialYear,
  getFinancialYears,
  deleteFinancialYear,
} from '../../controllers/admin/financialYear.controller.js';
import { financialYearValidationSchema, updateFinancialYearSchema } from '../../validations/financialYear.validator.js';
import validateBody from '../../middlewares/validator.middleware.js';

router.route('/create').post(validateBody(financialYearValidationSchema), createFinancialYear);
router.route('/set/:id').put(setFinancialYear);
router.route('/current').get(getCurrentFinancialYear);
router.route('/get').get(getFinancialYears);
router.route('/delete/:id').delete(deleteFinancialYear);

export default router;
