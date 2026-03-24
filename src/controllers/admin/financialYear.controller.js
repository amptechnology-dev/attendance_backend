import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../../utils/responseHandler.js';
import { FinancialYear } from '../../models/financialYear.model.js';
import { Month } from '../../models/month.model.js';
import { DutyTiming } from '../../models/dutyTiming.model.js';
import { Staff } from '../../models/staff.model.js';

export const createFinancialYear = expressAsyncHandler(async (req, res) => {
  const { yearLabel, startDate, endDate } = req.body;
  const existingFinancialYear = await FinancialYear.findOne({ yearLabel, office: req.admin.office });
  if (existingFinancialYear) {
    throw new ApiError(400, 'Financial Year already exists.');
  }
  if (endDate <= startDate) {
    throw new ApiError(400, 'End date must be greater than start date.');
  }

  const financialYear = await FinancialYear.create({ office: req.admin.office, yearLabel, startDate, endDate });
  return new ApiResponse(201, financialYear, 'Financial Year created successfully.').send(res);
});

export const setFinancialYear = expressAsyncHandler(async (req, res) => {
  const financialYear = await FinancialYear.findOne({ _id: req.params.id, office: req.admin.office });
  if (!financialYear) {
    throw new ApiError(404, 'Financial Year not found.');
  }
  if (financialYear.isActive) {
    throw new ApiError(400, 'Financial Year is already active.');
  }
  await FinancialYear.updateMany({ office: req.admin.office, isActive: true }, { isActive: false });
  const updatedFinancialYear = await financialYear.updateOne({ isActive: true });

  // Reset all staff's paid leave balance to default (e.g., 12 days)
  const { paidLeave } = await DutyTiming.findOne({ office: req.admin.office });
  await Staff.updateMany({ office: req.admin.office }, { allowedPaidLeaves: paidLeave });

  return new ApiResponse(200, updatedFinancialYear, 'Financial Year set successfully.').send(res);
});

export const deleteFinancialYear = expressAsyncHandler(async (req, res) => {
  const financialYear = await FinancialYear.findOne({ _id: req.params.id, office: req.admin.office });
  if (!financialYear) {
    throw new ApiError(404, 'Financial Year not found.');
  }
  if (financialYear.isActive) {
    throw new ApiError(400, 'Cannot delete the current financial year.');
  }
  if (await Month.findOne({ financialYear: financialYear._id })) {
    throw new ApiError(400, 'Cannot delete a financial year with associated months.');
  }

  await financialYear.deleteOne();
  return new ApiResponse(200, financialYear, 'Financial Year deleted successfully.').send(res);
});

export const getFinancialYears = expressAsyncHandler(async (req, res) => {
  const financialYears = await FinancialYear.find({ office: req.admin.office });
  return new ApiResponse(200, financialYears, 'Financial Years fetched successfully.').send(res);
});

export const getCurrentFinancialYear = expressAsyncHandler(async (req, res) => {
  const currentFinancialYear = await FinancialYear.findOne({ isActive: true, office: req.admin.office });
  if (!currentFinancialYear) {
    throw new ApiError(404, 'Current Financial Year not found.');
  }
  return new ApiResponse(200, currentFinancialYear, 'Current Financial Year fetched successfully.').send(res);
});
