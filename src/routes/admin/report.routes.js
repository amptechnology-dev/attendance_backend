import { Router } from 'express';
import {
  getAttendanceReport,
  getSalaryReport,
  getSalaryReportPdf,
  getAttendanceReportPdf,
  getAttendanceReportCsv,
  getMonthlyAttendanceReport,
  getYearlyAttendanceReport,
  getSalaryReportCsv,
  getLeaveReport,
  getLeaveReportPdf,
  getLeaveReportCsv,
  getDepartmentWiseAttendanceReport,
  getPerformanceReport,
  getMonthlySalaryReport,
  getPfEcrCsv,
  getEsiEcrCsv,
  getPerformanceReportPdf,
  getHolidayFundReport,
  getHolidayFundReportPdf,
  getHolidayFundReportCsv,
} from '../../controllers/admin/report.controller.js';
const router = Router();

router.route('/attendance').get(getAttendanceReport);
router.route('/attendance-pdf').get(getAttendanceReportPdf);
router.route('/attendance-csv').get(getAttendanceReportCsv);
router.route('/monthly-attendance').get(getMonthlyAttendanceReport);
router.route('/yearly-attendance').get(getYearlyAttendanceReport);
router.route('/salary').get(getSalaryReport);
router.route('/salary-pdf').get(getSalaryReportPdf);
router.route('/salary-csv').get(getSalaryReportCsv);
router.route('/leave').get(getLeaveReport);
router.route('/leave-pdf').get(getLeaveReportPdf);
router.route('/leave-csv').get(getLeaveReportCsv);
router.route('/department-wise-attendance').get(getDepartmentWiseAttendanceReport);
router.route('/performance').get(getPerformanceReport);
router.route('/performance-pdf').get(getPerformanceReportPdf);
router.route('/monthly-salary').get(getMonthlySalaryReport);
router.route('/pf-ecr-csv').get(getPfEcrCsv);
router.route('/esi-ecr-csv').get(getEsiEcrCsv);
router.route('/holiday-fund').get(getHolidayFundReport);
router.route('/holiday-fund-pdf').get(getHolidayFundReportPdf);
router.route('/holiday-fund-csv').get(getHolidayFundReportCsv);

export default router;
