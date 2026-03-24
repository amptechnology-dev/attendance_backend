import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { SalaryStructure, Salary } from '../models/salary.model.js';
import { autoCalculateAllSalary } from '../services/salary.service.js';
import { saveAdvanceSalary, generateSalaryPdf, generateSalaryByMonth } from '../services/salary.service.js';
import { AdvanceTransaction } from '../models/salary.model.js';
import { HolidayFund } from '../models/holidayFund.model.js';
import { Office } from '../models/office.model.js';
import { getCurrentDate } from '../utils/dateTime.utils.js';
import { startOfMonth, subMonths } from 'date-fns';

export const putSalaryStructure = expressAsyncHandler(async (req, res) => {
  const updatedSalaryStructure = await SalaryStructure.findOneAndUpdate({ office: req.admin.office }, req.body, {
    upsert: true,
    new: true,
  });
  return new ApiResponse(200, updatedSalaryStructure, 'Salary structure updated successfully.').send(res);
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
  const data = await autoCalculateAllSalary(req.admin.office, month, year);
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
  }).populate('staff', 'fullName staffId');
  data.sort((a, b) => a.staff.fullName.localeCompare(b.staff.fullName));

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
