import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { Holiday } from '../models/holiday.model.js';
import { Department } from '../models/department.model.js';
import { FinancialYear } from '../models/financialYear.model.js';
import { permissions } from '../config/constants.js';
import { getMonthBoundariesFormatted } from '../utils/dateTime.utils.js';

export const createHoliday = expressAsyncHandler(async (req, res) => {
  const { department, name, date, forAllDepartments, notes } = req.body;
  if (department && forAllDepartments === 'true') {
    throw new ApiError(400, 'Cannot select department when forAllDepartments is true.');
  }
  if (department && !(await Department.findById(department))) {
    throw new ApiError(400, 'Validation Failed!', [{ field: 'department', message: 'Invalid Department ID.' }]);
  }
  if (forAllDepartments !== 'true' && !department) {
    throw new ApiError(400, 'Validation Failed!', [
      { field: 'forAllDepartments', message: 'Department ID or forAllDepartments: true is required.' },
    ]);
  }
  const existingHoliday = await Holiday.findOne({ date, department, forAllDepartments, office: req.admin.office });
  if (existingHoliday) {
    throw new ApiError(400, 'Holiday already exists.');
  }

  const holiday = await Holiday.create({
    office: req.admin.office,
    department,
    name,
    date,
    forAllDepartments,
    notes,
  });
  return new ApiResponse(201, holiday, 'Holiday created successfully.').send(res);
});

export const deleteHoliday = expressAsyncHandler(async (req, res) => {
  const holiday = await Holiday.findOne({ _id: req.params.id, office: req.admin.office });
  if (!holiday) {
    throw new ApiError(404, 'Holiday not found.');
  }
  await holiday.deleteOne();
  return new ApiResponse(200, holiday, 'Holiday deleted successfully.').send(res);
});

export const getHolidays = expressAsyncHandler(async (req, res) => {
  const user = req.admin || req.staff;
  const hasFullAccess =
    user.role?.permissions?.includes('*') || user.role?.permissions?.includes(permissions.VIEW_ALL_OFFDAYS);

  const holidays = await Holiday.find({
    office: user.office,
    ...(hasFullAccess ? {} : { $or: [{ forAllDepartments: true }, { department: user.department }] }),
  })
    .populate('department', 'name _id')
    .sort('date');
  return new ApiResponse(200, holidays, 'Holidays fetched successfully.').send(res);
});

export const getHolidayByDate = expressAsyncHandler(async (req, res) => {
  const { date } = req.params;
  const holiday = await Holiday.findOne({ date, office: req.admin.office || req.user.office });
  return new ApiResponse(200, holiday, 'Holiday checked successfully.').send(res);
});

export const getHolidaysByDepartment = expressAsyncHandler(async (req, res) => {
  const { department } = req.params;
  const holidays = await Holiday.find({ department, office: req.admin.office || req.user.office });
  return new ApiResponse(200, holidays, 'Holidays fetched successfully.').send(res);
});

//TODO: Do something accept year instead of financial year id
export const getHolidaysByFinancialYear = expressAsyncHandler(async (req, res) => {
  const { financial_year } = req.params;
  const financialYear = await FinancialYear.findById(financial_year);
  if (!financial_year || !financialYear) {
    throw new ApiError(400, 'Validation Failed!', [{ field: 'financialYear', message: 'Invalid Financial Year ID.' }]);
  }

  const holidays = await Holiday.find({
    date: { $gte: financialYear.startDate, $lte: financialYear.endDate },
    office: req.admin.office || req.user.office,
  });
  return new ApiResponse(200, holidays, 'Holidays fetched successfully.').send(res);
});

export const getHolidaysByMonth = expressAsyncHandler(async (req, res) => {
  let { month, year } = req.params;
  month = parseInt(month, 10);
  year = parseInt(year, 10);
  let monthFilter = {};
  if (!isNaN(month) && !isNaN(year) && month >= 1 && month <= 12) {
    const { startDate, endDate } = getMonthBoundariesFormatted(month, year);
    monthFilter = { date: { $gte: startDate, $lte: endDate } };
  } else {
    throw new ApiError(400, 'Validation Failed!', [{ field: 'month', message: 'Invalid month number.' }]);
  }

  const holidays = await Holiday.find({
    ...monthFilter,
    office: req.admin.office || req.user.office,
  });
  return new ApiResponse(200, holidays, 'Holidays fetched successfully.').send(res);
});
