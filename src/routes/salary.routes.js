import { Router } from 'express';
import {
  putSalaryStructure,
  getSalaryStructure,
  autoCalculateAllSalaryByMonth,
  getAllSalary,
  getPreviousMonthSalary,
  addAdvanceSalary,
  updateAdvanceSalary,
  markAdvanceAsPaid,
  getSalaryPdfByStaff,
  getSalaryPdfByMonth,
  getAdvanceSalaryTransactions,
  getHolidayFundTransactions,
  getPastMonthSalary,
} from '../controllers/salary.controller.js';
import { adminAuth } from '../middlewares/auth.middleware.js';
import validate from '../middlewares/validator.middleware.js';
import { parseMonthInput } from '../middlewares/bodyParser.middleware.js';
import { salaryStructureSchema, updateAdvanceSalaryValidationSchema } from '../validations/salary.validation.js';
import { monthYearSchema } from '../validations/monthYear.validation.js';

const router = Router();
router.use(adminAuth);
router.route('/structure/update').put(validate(salaryStructureSchema, true), putSalaryStructure);
router.route('/structure/get').get(getSalaryStructure);
router.route('/auto-calculate/month').post(parseMonthInput, validate(monthYearSchema), autoCalculateAllSalaryByMonth);
router.route('/get/all').get(getAllSalary);
router.route('/get/previous-month').get(getPreviousMonthSalary);
router.route('/get/past-months').get(getPastMonthSalary);
router.route('/advance/add').post(validate(updateAdvanceSalaryValidationSchema), addAdvanceSalary);
router.route('/advance/update').put(validate(updateAdvanceSalaryValidationSchema), updateAdvanceSalary);
router.route('/advance/mark-as-paid').post(markAdvanceAsPaid);
router.route('/slip/get-by-staff').post(parseMonthInput, validate(monthYearSchema), getSalaryPdfByStaff);
router.route('/slip/get-by-month').post(parseMonthInput, validate(monthYearSchema), getSalaryPdfByMonth);
router.route('/advance-transaction/get').get(getAdvanceSalaryTransactions);
router.route('/holiday-fund-transaction/get').get(getHolidayFundTransactions);

export default router;
