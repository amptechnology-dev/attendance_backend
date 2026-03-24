import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { WeekOff } from '../models/weekOff.model.js';
import { Department } from '../models/department.model.js';
import { permissions } from '../config/constants.js';
import { getMonthBoundariesFormatted } from '../utils/dateTime.utils.js';

export const createWeekOff = expressAsyncHandler(async (req, res) => {
  const { department, date, forAllDepartments, reason } = req.body;
  if (department && forAllDepartments === 'true') {
    throw new ApiError(400, 'Cannot select department when forAllDepartments is true.');
  }
  if (department && !(await Department.findById(department))) {
    throw new ApiError(400, 'Validation Failed!', [{ field: 'department', message: 'Invalid Department ID.' }]);
  }
  const existingWeekOff = await WeekOff.findOne({
    date,
    office: req.admin.office,
    $or: [{ department }, { forAllDepartments: true }],
  });
  if (existingWeekOff) {
    throw new ApiError(401, 'Bad Request!', [
      { field: 'date', message: 'Week Off conflict exists with another record.' },
    ]);
  }
  if (forAllDepartments !== 'true' && !department) {
    throw new ApiError(400, 'Validation Failed!', [
      { field: 'forAllDepartments', message: 'Department ID or forAllDepartments: true is required.' },
    ]);
  }
  const weekOff = await WeekOff.create({ office: req.admin.office, department, forAllDepartments, date, reason });
  return new ApiResponse(201, weekOff, 'Week Off created successfully.').send(res);
});

export const updateWeekOff = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  let { department, forAllDepartments, date, reason } = req.body;

  const weekOff = await WeekOff.findById(id);
  if (!weekOff || weekOff.office.toString() !== req.admin.office.toString()) {
    throw new ApiError(404, 'Not Found!', [{ field: 'id', message: 'Week Off not found.' }]);
  }

  // Convert forAllDepartments to boolean
  forAllDepartments = forAllDepartments === 'true';

  // Validation checks
  if (forAllDepartments && department) {
    throw new ApiError(400, 'Cannot select department when forAllDepartments is true.');
  }
  if (!forAllDepartments && department && !(await Department.findById(department))) {
    throw new ApiError(400, 'Validation Failed!', [{ field: 'department', message: 'Invalid Department ID.' }]);
  }
  if (!forAllDepartments && !department) {
    throw new ApiError(400, 'Validation Failed!', [
      { field: 'forAllDepartments', message: 'Department ID or forAllDepartments: true is required.' },
    ]);
  }

  // Check if a conflicting week-off exists
  const existingWeekOff = await WeekOff.findOne({
    _id: { $ne: id }, // Exclude the current record
    office: req.admin.office,
    date: date || weekOff.date,
    $or: forAllDepartments
      ? [{ forAllDepartments: true }] // If setting forAllDepartments, check if another global week-off exists
      : [{ department: department || weekOff.department }, { forAllDepartments: true }],
  });
  if (existingWeekOff) {
    throw new ApiError(401, 'Bad Request!', [
      { field: 'date', message: 'Week Off conflict exists with another record.' },
    ]);
  }

  // Update the week-off
  weekOff.forAllDepartments = forAllDepartments;
  weekOff.department = forAllDepartments ? null : department || weekOff.department;
  weekOff.date = date || weekOff.date;
  weekOff.reason = reason === '' ? '-' : reason || weekOff.reason;
  await weekOff.save();

  return new ApiResponse(200, weekOff, 'Week Off updated successfully.').send(res);
});

export const deleteWeekOff = expressAsyncHandler(async (req, res) => {
  const weekOff = await WeekOff.findOne({ _id: req.params.id, office: req.admin.office });
  if (!weekOff) {
    throw new ApiError(404, 'Week Off not found.');
  }
  await weekOff.deleteOne();
  return new ApiResponse(200, weekOff, 'Week Off deleted successfully.').send(res);
});

export const getWeekOffs = expressAsyncHandler(async (req, res) => {
  const user = req.admin || req.staff;
  const hasFullAccess =
    user.role?.permissions?.includes('*') || user.role?.permissions?.includes(permissions.VIEW_ALL_OFFDAYS);

  const weekOffs = await WeekOff.find({
    office: user.office,
    ...(hasFullAccess ? {} : { $or: [{ forAllDepartments: true }, { department: user.department }] }),
  })
    .populate('department', 'name _id')
    .sort('date');
  return new ApiResponse(200, weekOffs, 'Week Offs fetched successfully.').send(res);
});

export const getWeekOffByDate = expressAsyncHandler(async (req, res) => {
  const { date } = req.params;
  const weekOff = await WeekOff.findOne({ date, office: req.admin.office || req.staff.office });
  return new ApiResponse(200, weekOff, 'Week Off checked successfully.').send(res);
});

export const getWeekOffByDepartment = expressAsyncHandler(async (req, res) => {
  const { department } = req.params;
  const weekOff = await WeekOff.findOne({ department, office: req.admin.office || req.user.office });
  return new ApiResponse(200, weekOff, 'Week Off checked successfully.').send(res);
});

export const getWeekOffsByMonth = expressAsyncHandler(async (req, res) => {
  let { month, year } = req.params;
  month = parseInt(month, 10);
  year = parseInt(year, 10);
  let monthFilter = {};
  if (!isNaN(month) && !isNaN(year) && month >= 1 && month <= 12) {
    const { startDate, endDate } = getMonthBoundariesFormatted(month, year);
    monthFilter = { date: { $gte: startDate, $lte: endDate } };
  } else {
    throw new ApiError(400, 'Validation Failed!', [{ field: 'month', message: 'Invalid month number/year.' }]);
  }

  const weekOffs = await WeekOff.find({
    ...monthFilter,
    office: req.admin.office || req.user.office,
  });
  return new ApiResponse(200, weekOffs, 'Week Offs fetched successfully.').send(res);
});
