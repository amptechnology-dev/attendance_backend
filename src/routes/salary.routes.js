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
  getSalaryExcelByMonth,
  getSalaryTablesByMonth,
  getSalaryRegisterPdfByMonth,
  getAdvanceSalaryTransactions,
  getHolidayFundTransactions,
  getPastMonthSalary,
  updateManualConveyance,
  updateManualAdvance,
  freezeSalaryForMonth,
  confirmUnfreeze,
  requestUnfreezeOtp
} from '../controllers/salary.controller.js';
import {getOvertimeReportByMonth, applyOvertimeForStaff} from '../controllers/overtime.controller.js';
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
router.route('/excel/get-by-month').post(parseMonthInput, validate(monthYearSchema), getSalaryExcelByMonth);
router.route('/table/get-by-month').post(parseMonthInput, validate(monthYearSchema), getSalaryTablesByMonth);
router.route('/register/pdf/get-by-month').post(parseMonthInput, validate(monthYearSchema), getSalaryRegisterPdfByMonth);
router.route('/advance-transaction/get').get(getAdvanceSalaryTransactions);
router.route('/holiday-fund-transaction/get').get(getHolidayFundTransactions);
router.route('/:salaryId/conveyance/update').put(updateManualConveyance);
router.route('/:salaryId/advance/update').put(updateManualAdvance);
router.route('/overtime/report').get(getOvertimeReportByMonth);
router.route('/overtime/apply').post(applyOvertimeForStaff);
router.route('/freeze').post(freezeSalaryForMonth);
router.route('/unfreeze/request-otp').post(requestUnfreezeOtp);
router.route('/unfreeze/confirm').post(confirmUnfreeze);

export default router;
