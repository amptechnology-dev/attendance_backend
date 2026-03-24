import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../../utils/responseHandler.js';
import { Month } from '../../models/month.model.js';
import { FinancialYear } from '../../models/financialYear.model.js';

export const createMonth = expressAsyncHandler(async (req, res) => {
  const { startDate, endDate, monthNumber, year, financialYear } = req.body;
  const existingMonth = await Month.findOne({ office: req.admin.office, monthNumber, year });
  if (existingMonth) {
    throw new ApiError(400, 'Month already exists.');
  }
  if (endDate <= startDate) {
    throw new ApiError(400, 'End date must be greater than start date.');
  }

  if (!(await FinancialYear.findOne({ office: req.admin.office, _id: financialYear }))) {
    throw new ApiError(400, 'Invalid Financial Year.');
  }

  const month = await Month.create({
    office: req.admin.office,
    startDate,
    endDate,
    monthNumber,
    year,
    financialYear,
  });
  return new ApiResponse(201, month, 'Month created successfully.').send(res);
});

export const updateMonth = expressAsyncHandler(async (req, res) => {
  const month = await Month.findOne({ _id: req.params.id, office: req.admin.office });
  if (!month) {
    throw new ApiError(404, 'Month not found.');
  }
  const { startDate, endDate, monthNumber, year, financialYear } = req.body;
  if (endDate <= startDate) {
    throw new ApiError(400, 'Validation Failed!', [{ message: 'End date must be greater than start date.' }]);
  }
  if (await Month.findOne({ office: req.admin.office, monthNumber, year, financialYear })) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'monthNumber',
        message: 'Month number already exists.',
      },
    ]);
  }
  if (!(await FinancialYear.findOne({ office: req.admin.office, _id: financialYear }))) {
    throw new ApiError(400, 'Invalid Financial Year.');
  }

  const updatedMonth = await Month.findOneAndUpdate(
    { _id: req.params.id },
    { startDate, endDate, monthNumber, year, financialYear },
    { new: true }
  );
  return new ApiResponse(200, updatedMonth, 'Month updated successfully.').send(res);
});

export const setCurrentMonth = expressAsyncHandler(async (req, res) => {
  const month = await Month.findOne({ _id: req.params.id, office: req.admin.office });
  if (!month) {
    throw new ApiError(404, 'Month not found.');
  }
  if (month.isCurrentMonth) {
    throw new ApiError(400, 'Month is already current.');
  }

  const currentMonth = await Month.findOne({ office: req.admin.office, isCurrentMonth: true });
  if (currentMonth) {
    await Month.updateMany({ office: req.admin.office, isPreviousMonth: true }, { isPreviousMonth: false });
    await currentMonth.updateOne({ isCurrentMonth: false, isPreviousMonth: true });
  }
  const updatedMonth = await Month.findOneAndUpdate({ _id: req.params.id }, { isCurrentMonth: true }, { new: true });
  return new ApiResponse(200, [{ currentMonth, updatedMonth }], 'Month set as current successfully.').send(res);
});

export const getMonths = expressAsyncHandler(async (req, res) => {
  const months = await Month.find({ office: req.admin.office })
    .populate('financialYear', 'yearLabel')
    .sort('monthNumber year');
  return new ApiResponse(200, months, 'Months fetched successfully.').send(res);
});

export const getMonthById = expressAsyncHandler(async (req, res) => {
  const month = await Month.findById(req.params.id);
  if (!month) {
    throw new ApiError(404, 'Month not found.');
  }
  return new ApiResponse(200, month, 'Month fetched successfully.').send(res);
});

export const getCurrentMonth = expressAsyncHandler(async (req, res) => {
  const month = await Month.findOne({ office: req.admin.office, isCurrentMonth: true });
  if (!month) {
    throw new ApiError(404, 'Current month not found.');
  }
  return new ApiResponse(200, month, 'Current month fetched successfully.').send(res);
});
