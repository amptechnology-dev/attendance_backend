import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../../utils/responseHandler.js';
import {
  generateAttendanceReport,
  generateSalaryReport,
  generateSalaryPDF,
  generateAttendancePDF,
  generateAttendanceCsv,
  generateMonthlyAttendanceReport,
  generateYearlyAttendanceReport,
  generateSalaryCsv,
  generateLeavesReport,
  generateLeavesPDF,
  generateLeavesCsv,
  generateDepartmentWiseAttendance,
  generateDepartmentAttendancePDF,
  generatePerformanceReport,
  generatePerformanceReportPDF,
  generateMonthlySalaryReport,
  generatePfEcrCsv,
  generateEsiEcrCsv,
  generateHolidayFundReport,
  generateHolidayFundReportPdf,
  generateHolidayFundReportCsv,
} from '../../services/report.service.js';
import { Office } from '../../models/office.model.js';
import { getMonthBoundariesFormatted } from '../../utils/dateTime.utils.js';

export const getAttendanceReport = expressAsyncHandler(async (req, res) => {
  try {
    const filter = { ...req.query, office: req.admin.office };
    const data = await generateAttendanceReport(filter);
    return new ApiResponse(200, data, 'Attendance report fetched successfully.').send(res);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getAttendanceReportPdf = expressAsyncHandler(async (req, res) => {
  try {
    const filter = req.query;
    const reportData = await generateAttendanceReport({ ...filter, office: req.admin.office });
    const office = await Office.findById(req.admin.office).select('name');
    // Generate the PDF buffer
    const pdfBuffer = await generateAttendancePDF(office.name, reportData.report, filter);

    // Set headers and send the PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="attendance_report.pdf"');
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getAttendanceReportCsv = expressAsyncHandler(async (req, res) => {
  try {
    const filter = req.query;
    const reportData = await generateAttendanceReport({ ...filter, office: req.admin.office });

    // Generate CSV string
    const csvData = await generateAttendanceCsv(reportData.report);

    // Trigger download in response
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance_report.csv"');
    res.status(200).end(csvData);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getMonthlyAttendanceReport = expressAsyncHandler(async (req, res) => {
  try {
    // const { month, year } = req.query;
    const data = await generateMonthlyAttendanceReport({ office: req.admin.office, ...req.query });

    return new ApiResponse(200, data, 'Monthly attendance report fetched successfully.').send(res);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getYearlyAttendanceReport = expressAsyncHandler(async (req, res) => {
  try {
    const pdfBuffer = await generateYearlyAttendanceReport({ office: req.admin.office, ...req.query });

    // Set headers and send the PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="yearly_attendance_report.pdf"');
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getSalaryReport = expressAsyncHandler(async (req, res) => {
  try {
    const filter = { ...req.query, office: req.admin.office };
    const data = await generateSalaryReport(filter);
    return new ApiResponse(200, data, 'Salary report fetched successfully.').send(res);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getSalaryReportPdf = expressAsyncHandler(async (req, res) => {
  try {
    const filter = req.query;
    const reportData = await generateSalaryReport({ ...filter, office: req.admin.office });
    const office = await Office.findById(req.admin.office).select('name');
    // Generate the PDF buffer
    const pdfBuffer = await generateSalaryPDF(office.name, reportData.report, filter);

    // Set headers and send the PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="salary_report.pdf"');
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getSalaryReportCsv = expressAsyncHandler(async (req, res) => {
  try {
    const filter = req.query;
    const reportData = await generateSalaryReport({ ...filter, office: req.admin.office });

    // Generate CSV string
    const csvData = await generateSalaryCsv(reportData.report);

    // Trigger download in response
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="salary_report.csv"');
    res.status(200).end(csvData);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getLeaveReport = expressAsyncHandler(async (req, res) => {
  try {
    const filter = { ...req.query, office: req.admin.office };
    const data = await generateLeavesReport(filter);
    return new ApiResponse(200, data, 'Leave report fetched successfully.').send(res);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getLeaveReportPdf = expressAsyncHandler(async (req, res) => {
  try {
    const filter = req.query;
    const reportData = await generateLeavesReport({ ...filter, office: req.admin.office });
    const office = await Office.findById(req.admin.office).select('name');
    // Generate the PDF buffer
    const pdfBuffer = await generateLeavesPDF(office.name, reportData.report, filter);

    // Set headers and send the PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="leave_report.pdf"');
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getLeaveReportCsv = expressAsyncHandler(async (req, res) => {
  try {
    const filter = req.query;
    const reportData = await generateLeavesReport({ ...filter, office: req.admin.office });

    // Generate CSV string
    const csvData = await generateLeavesCsv(reportData.report);

    // Trigger download in response
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="leaves_report.csv"');
    res.status(200).end(csvData);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getDepartmentWiseAttendanceReport = expressAsyncHandler(async (req, res) => {
  if (!req.query.month || !/^\d{4}-\d{1,2}$/.test(req.query.month)) {
    throw new ApiError(400, "Invalid Month.(expexted: 'YYYY-MM')");
  }
  const [year, month] = req.query.month?.split('-').map(Number);
  const { startDate, endDate } = getMonthBoundariesFormatted(month, year);

  const filter = { office: req.admin.office, startDate, endDate };
  const data = await generateDepartmentWiseAttendance(filter);
  if (!data?.length) throw new ApiError(400, 'No data found for the given month.');

  const office = await Office.findById(req.admin.office).select('name');
  // Generate the PDF buffer
  const pdfBuffer = await generateDepartmentAttendancePDF(office.name, data, req.query.month);

  // Set headers and send the PDF
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="Attendance_report.pdf"');
  return res.send(Buffer.from(pdfBuffer));
});

export const getPerformanceReport = expressAsyncHandler(async (req, res) => {
  try {
    const filter = { ...req.query, office: req.admin.office };
    if (!filter.rankBy?.trim()) throw new ApiError(400, 'Rank by field is required.');

    const data = await generatePerformanceReport(filter);
    return new ApiResponse(200, data, 'Performance report fetched successfully.').send(res);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getPerformanceReportPdf = expressAsyncHandler(async (req, res) => {
  try {
    const filter = req.query;
    const reportData = await generatePerformanceReport({ ...filter, office: req.admin.office });
    const office = await Office.findById(req.admin.office).select('name');
    // Generate the PDF buffer
    const pdfBuffer = await generatePerformanceReportPDF(office.name, reportData, filter);

    // Set headers and send the PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="performance_report.pdf"');
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getMonthlySalaryReport = expressAsyncHandler(async (req, res) => {
  try {
    const { month, year } = req.query;
    const data = await generateMonthlySalaryReport(req.admin.office, month, year);
    if (!data) throw new ApiError(400, 'No data!', { message: 'No data found!' });

    // Set headers and send the PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="monthly_salary_report.pdf"');
    res.send(Buffer.from(data));
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getPfEcrCsv = expressAsyncHandler(async (req, res) => {
  try {
    const { month, year } = req.query;
    const data = await generatePfEcrCsv(req.admin.office, month, year);
    if (!data) throw new ApiError(400, 'No data!', { message: 'No data found!' });

    // Trigger download in response
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="epf_ecr.csv"');
    res.status(200).end(data);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getEsiEcrCsv = expressAsyncHandler(async (req, res) => {
  try {
    const { month, year } = req.query;
    const data = await generateEsiEcrCsv(req.admin.office, month, year);
    if (!data) throw new ApiError(400, 'No data!', { message: 'No data found!' });

    // Trigger download in response
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="esi_ecr.csv"');
    res.status(200).end(data);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getHolidayFundReport = expressAsyncHandler(async (req, res) => {
  try {
    const filter = { ...req.query, office: req.admin.office };
    const data = await generateHolidayFundReport(filter);
    return new ApiResponse(200, data, 'Holiday fund report fetched successfully.').send(res);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getHolidayFundReportPdf = expressAsyncHandler(async (req, res) => {
  try {
    const filter = req.query;
    const reportData = await generateHolidayFundReport({ ...filter, office: req.admin.office });
    const office = await Office.findById(req.admin.office).select('name');
    // Generate the PDF buffer
    const pdfBuffer = await generateHolidayFundReportPdf(office.name, reportData.report, filter);

    // Set headers and send the PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="holiday_fund_report.pdf"');
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});

export const getHolidayFundReportCsv = expressAsyncHandler(async (req, res) => {
  try {
    const filter = req.query;
    const reportData = await generateHolidayFundReport({ ...filter, office: req.admin.office });

    // Generate CSV string
    const csvData = await generateHolidayFundReportCsv(reportData.report);

    // Trigger download in response
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="holiday_fund_report.csv"');
    res.status(200).end(csvData);
  } catch (error) {
    throw new ApiError(400, error.message, error.errors);
  }
});
