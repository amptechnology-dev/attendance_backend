import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { SalaryStructure, Salary } from '../models/salary.model.js';
import { autoCalculateAllSalary } from '../services/salary.service.js';
import {
  saveAdvanceSalary,
  generateSalaryPdf,
  generateSalaryByMonth,
  generateSalaryExcelByMonth,
  getSalaryTableByMonth,
  updateManualConveyanceForSalary,
} from '../services/salary.service.js';
import { AdvanceTransaction } from '../models/salary.model.js';
import { HolidayFund } from '../models/holidayFund.model.js';
import { Office } from '../models/office.model.js';
import { getCurrentDate } from '../utils/dateTime.utils.js';
import { startOfMonth, subMonths } from 'date-fns';

export const putSalaryStructure = expressAsyncHandler(async (req, res) => {
  const { grossSalary, basicSalary, da, otherAllowance, hra, conveyance, specialAllowance, pf, esi, pTax, bonus_rate } =
    req.body;

  // ---- Minimal but important validation (avoids garbage % values reaching payroll calc) ----
  const pctFields = [
    ['basicSalary.percentage', basicSalary?.percentage],
    ['da.percentage', da?.percentage],
    ['otherAllowance.percentage', otherAllowance?.percentage],
    ['hra.percentage', hra?.percentage],
    ['conveyance.percentage', conveyance?.percentage],
  ];
  for (const [label, value] of pctFields) {
    if (value !== undefined && (value < 0 || value > 100)) {
      return new ApiResponse(400, null, `${label} must be between 0 and 100.`).send(res);
    }
  }

  if (hra?.enabled && !['basic', 'gross', 'basicPlusDa'].includes(hra.calculateOn)) {
    return new ApiResponse(400, null, 'Invalid hra.calculateOn value.').send(res);
  }
  if (conveyance?.enabled && !['input', 'readonly'].includes(conveyance.mode)) {
    return new ApiResponse(400, null, 'Invalid conveyance.mode value.').send(res);
  }
  if (pf?.enabled && !['basic', 'basicPlusDa'].includes(pf.calculateOn)) {
    return new ApiResponse(400, null, 'Invalid pf.calculateOn value.').send(res);
  }

  const updatedSalaryStructure = await SalaryStructure.findOneAndUpdate(
    { office: req.admin.office },
    {
      office: req.admin.office,
      grossSalary,
      basicSalary,
      da,
      otherAllowance,
      hra,
      conveyance,
      specialAllowance,
      pf,
      esi,
      pTax,
      bonus_rate,
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  return new ApiResponse(200, updatedSalaryStructure, 'Salary structure saved successfully.').send(res);
});

export const addAdvanceSalary = expressAsyncHandler(async (req, res) => {
  const { staffId, totalAmount, remainingAmount, remainingMonths, remarks } = req.body;
  const result = await saveAdvanceSalary(staffId, totalAmount, remainingAmount, remainingMonths, remarks, 'add');
  return new ApiResponse(200, result, 'Advance added successfully.').send(res);
});

export const updateAdvanceSalary = expressAsyncHandler(async (req, res) => {
  const { staffId, totalAmount, remainingAmount, remainingMonths, remarks, pauseTill } = req.body;
  const result = await saveAdvanceSalary(
    staffId,
    totalAmount,
    remainingAmount,
    remainingMonths,
    remarks,
    pauseTill,
    'update'
  );
  return new ApiResponse(200, result, 'Advance updated successfully.').send(res);
});

export const markAdvanceAsPaid = expressAsyncHandler(async (req, res) => {
  const { staffId, remarks = 'Marked as fully paid' } = req.body;
  const result = await saveAdvanceSalary(staffId, 0, 0, 0, remarks, 'update');
  return new ApiResponse(200, result, 'Advance marked as fully paid.').send(res);
});

export const getSalaryStructure = expressAsyncHandler(async (req, res) => {
  const salaryStructure = await SalaryStructure.findOne({ office: req.admin.office });
  if (!salaryStructure) {
    throw new ApiError(404, 'Salary structure not found.');
  }
  return new ApiResponse(200, salaryStructure, 'Salary structure fetched successfully.').send(res);
});

export const autoCalculateAllSalaryByMonth = expressAsyncHandler(async (req, res) => {
  const { month, year } = req.body;

  const data = await autoCalculateAllSalary(
    req.admin.office,
    month,
    year,
    req.admin._id
  );

  return new ApiResponse(200, data, 'Salary calculated successfully.').send(res);
});

export const getAllSalary = expressAsyncHandler(async (req, res) => {
  const data = await Salary.aggregate([
    { $match: { office: req.admin.office } },
    {
      $lookup: {
        from: 'staffs',
        localField: 'staff',
        foreignField: '_id',
        as: 'staff',
      },
    },
    { $unwind: '$staff' },
    {
      $sort: {
        year: -1,
        month: -1,
        'staff.fullName': 1,
      },
    },
  ]);
  return new ApiResponse(200, data, 'All salary fetched successfully.').send(res);
});

export const getPreviousMonthSalary = expressAsyncHandler(async (req, res) => {
  const now = new Date(getCurrentDate());
  const previousMonthDate = subMonths(startOfMonth(now), 1);
  const previousMonthNumber = previousMonthDate.getMonth() + 1; // getMonth is 0-based
  const previousMonthYear = previousMonthDate.getFullYear();

  const data = await Salary.find({
    office: req.admin.office,
    month: previousMonthNumber,
    year: previousMonthYear,
  })
    .populate('staff', 'fullName staffId')
    .lean(); // <-- prevents Mongoose from re-injecting schema defaults for $unset breakdown fields

  data.sort((a, b) => (a.staff?.fullName || '').localeCompare(b.staff?.fullName || ''));

  return new ApiResponse(200, data, 'Previous month salary fetched successfully.').send(res);
});

export const getPastMonthSalary = expressAsyncHandler(async (req, res) => {
  const { months } = req.query;
  const monthsInt = parseInt(months);

  if (isNaN(monthsInt) || monthsInt <= 0 || monthsInt > 12) {
    return res.status(400).json({ message: 'Invalid number of months.' });
  }
  // Calculate the target date
  const currentDate = new Date();
  const targetDate = subMonths(currentDate, monthsInt);
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth() + 1;

  // NOTE: aggregate() already returns plain JS objects (no Mongoose hydration),
  // so schema defaults are never auto-injected here. No .lean() needed/possible
  // on an aggregate pipeline — this function was never affected by the bug.
  const data = await Salary.aggregate([
    { $match: { office: req.admin.office } },
    {
      $lookup: {
        from: 'staffs',
        localField: 'staff',
        foreignField: '_id',
        as: 'staff',
      },
    },
    { $unwind: '$staff' },
    {
      $match: {
        $or: [{ year: { $gt: targetYear } }, { year: targetYear, month: { $gte: targetMonth } }],
      },
    },
    {
      $sort: {
        year: -1,
        month: -1,
        'staff.fullName': 1,
      },
    },
  ]);

  return new ApiResponse(200, data, 'Past salary records fetched successfully.').send(res);
});

export const getSalaryPdfByStaff = expressAsyncHandler(async (req, res) => {
  const { staffId, month, year } = req.body;

  // Generate the PDF buffer
  const pdfBuffer = await generateSalaryPdf(req.admin.office, staffId, parseInt(month), parseInt(year));

  // Set headers and send the PDF
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="attendance_report.pdf"');
  res.send(Buffer.from(pdfBuffer));
});

export const getSalaryPdfByMonth = expressAsyncHandler(async (req, res) => {
  const { month, year } = req.body;

  // Generate the PDF buffer
  const pdfBuffer = await generateSalaryByMonth(req.admin.office, parseInt(month), parseInt(year));

  // Set headers and send the PDF
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="salary_slip.pdf"');
  res.send(Buffer.from(pdfBuffer));
});

export const getSalaryExcelByMonth = expressAsyncHandler(async (req, res) => {
  const { month, year } = req.body;

  const excelBuffer = await generateSalaryExcelByMonth(req.admin.office, parseInt(month), parseInt(year));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="salary_sheet_${month}_${year}.xlsx"`);
  res.send(Buffer.from(excelBuffer));
});

export const getSalaryTablesByMonth = expressAsyncHandler(async (req, res) => {
  const { month, year } = req.body;
  const data = await getSalaryTableByMonth(req.admin.office, parseInt(month), parseInt(year));
  return new ApiResponse(200, data, 'Salary table fetched successfully.').send(res);
});

export const getAdvanceSalaryTransactions = expressAsyncHandler(async (req, res) => {
  const data = await AdvanceTransaction.find({ office: req.admin.office })
    .populate('staff', 'fullName staffId')
    .sort({ createdAt: -1 })
    .limit(1000);
  return new ApiResponse(200, data, 'Advance salary transactions fetched successfully.').send(res);
});

export const getHolidayFundTransactions = expressAsyncHandler(async (req, res) => {
  const transaction = await HolidayFund.find({ office: req.admin.office })
    .populate('staff', 'fullName staffId')
    .sort({ createdAt: -1 });
  const { holidayFundBalance } = await Office.findById(req.admin.office).select('holidayFundBalance');

  return new ApiResponse(
    200,
    { holidayFundBalance, transaction },
    'Holiday fund transactions fetched successfully.'
  ).send(res);
});

// Update manual conveynance
export const updateManualConveyance = expressAsyncHandler(async (req, res) => {
  const { salaryId } = req.params;
  const { amount } = req.body;

  if (amount === undefined || isNaN(amount) || amount < 0) {
    throw new ApiError(400, 'Bad Request', 'A valid non-negative conveyance amount is required.');
  }

  const updatedSalary = await updateManualConveyanceForSalary(req.admin.office, salaryId, Number(amount));

  return new ApiResponse(200, updatedSalary, 'Conveyance updated and salary breakdown recalculated successfully.').send(
    res
  );
});
