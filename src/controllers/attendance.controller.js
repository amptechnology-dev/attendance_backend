import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { Attendance } from '../models/attendance.model.js';
import { Leave } from '../models/leave.model.js';
import { Staff } from '../models/staff.model.js';
import { autoAttendanceCalculateByStaffId } from '../services/attendance.service.js';
import { parseISO, isValid, subDays, formatDate } from 'date-fns';
import { permissions } from '../config/constants.js';
import {
  getCurrentDate,
  getMonthBoundariesFormatted,
  getLocalMonthBoundariesFormatted,
} from '../utils/dateTime.utils.js';
import { Holiday } from '../models/holiday.model.js';
import { WeekOff } from '../models/weekOff.model.js';
import { OffDayWork } from '../models/offDayWork.model.js';

export const getAttendanceLogs = expressAsyncHandler(async (req, res) => {
  let { startDate, endDate, days, limit } = req.query;
  const user = req.admin;

  let filters = { office: user.office };
  if (startDate) {
    filters.date = { ...(filters.date || {}), $gte: new Date(startDate) };
  }
  if (endDate) {
    filters.date = { ...(filters.date || {}), $lte: new Date(endDate) };
  }
  if (days) {
    const currentDate = getCurrentDate();
    filters.date = { ...(filters.date || {}), $gte: subDays(new Date(currentDate), parseInt(days)) };
  }
  let staffMatchFilter = {};
  // Check if user has full attendance view rights
  const hasFullAccess =
    user.role?.permissions?.includes(permissions.ALL) ||
    user.role?.permissions?.includes(permissions.VIEW_ALL_ATTENDANCE);

  if (!hasFullAccess) {
    // Restrict to department-level attendance
    const allStaffs = await Staff.find({
      office: user.office,
      department: user.department,
    }).select('_id');

    const staffIds = allStaffs.map((s) => s._id);
    staffMatchFilter.staffId = { $in: staffIds };
  }

  const attendances = await Attendance.find({ ...filters, ...staffMatchFilter })
    .populate('staffId', 'fullName id staffId')
    .populate('logs')
    .sort('-date -createdAt')
    .limit(limit && !isNaN(parseInt(limit)) ? parseInt(limit) : undefined);
  return new ApiResponse(200, attendances, 'All attendance fetched successfully').send(res);
});

export const getAttendanceLogsByMonth = expressAsyncHandler(async (req, res) => {
  let { month, year, limit } = req.query;
  const user = req.admin;

  // By default, current month attendance only
  const { startDate, endDate } = getLocalMonthBoundariesFormatted();
  let monthFilter = { date: { $gte: startDate, $lte: endDate } };

  month = parseInt(month, 10);
  year = parseInt(year, 10);
  if (!isNaN(month) && !isNaN(year) && month >= 1 && month <= 12) {
    const { startDate, endDate } = getMonthBoundariesFormatted(month, year);
    monthFilter = { date: { $gte: startDate, $lte: endDate } };
  }

  let staffMatchFilter = {};
  // Check if user has full attendance view rights
  const hasFullAccess =
    user.role?.permissions?.includes(permissions.ALL) ||
    user.role?.permissions?.includes(permissions.VIEW_ALL_ATTENDANCE);

  if (!hasFullAccess) {
    // Restrict to department-level attendance
    const allStaffs = await Staff.find({
      office: user.office,
      department: user.department,
    }).select('_id');

    const staffIds = allStaffs.map((s) => s._id);
    staffMatchFilter.staffId = { $in: staffIds };
  }

  const attendances = await Attendance.find({ office: user.office, ...monthFilter, ...staffMatchFilter })
    .populate('staffId', 'fullName id staffId')
    .populate('logs')
    .sort('-date -createdAt')
    .limit(limit && !isNaN(parseInt(limit)) ? parseInt(limit) : undefined);
  return new ApiResponse(200, attendances, 'All attendance fetched successfully').send(res);
});

export const getAttendanceByStaffId = expressAsyncHandler(async (req, res) => {
  const staffId = req.params?.staffId || req.staff?._id;

  const { startDate, endDate, status, leaveStatus, limit } = req.query;
  const filters = {};
  if (status?.trim()) filters.status = status.trim();
  if (leaveStatus?.trim()) filters.leaveStatus = leaveStatus.trim();

  if (startDate && isValid(parseISO(startDate))) {
    filters.date = { ...(filters.date || {}), $gte: startDate };
  }
  if (endDate && isValid(parseISO(endDate))) {
    filters.date = { ...(filters.date || {}), $lte: endDate };
  }

  const attendances = await Attendance.find({ office: req.admin?.office || req.staff?.office, staffId, ...filters })
    .populate('staffId', 'fullName id staffId')
    .populate('logs')
    .sort('-date -createdAt')
    .limit(limit && !isNaN(parseInt(limit)) ? parseInt(limit) : undefined);
  return new ApiResponse(200, attendances, 'Attendance fetched successfully').send(res);
});

export const getTodayAttendance = expressAsyncHandler(async (req, res) => {
  const today = getCurrentDate();

  const allStaff = await Staff.find({ office: req.admin.office, status: 'active' }).sort('fullName');
  // Get IDs for filtering
  const staffIds = allStaff.map((s) => s._id);

  const attendances = await Attendance.find({
    office: req.admin.office,
    staffId: { $in: staffIds },
    date: today,
  })
    .select('-__v -office')
    .populate('staffId', 'fullName staffId')
    .populate('logs');

  // map for fast lookup
  const attendanceMap = new Map();
  attendances.forEach((att) => {
    attendanceMap.set(att.staffId._id.toString(), att);
  });

  // Combine attendance and non-attendance
  const attendance = allStaff.map((staff) => {
    const record = attendanceMap.get(staff._id.toString());
    if (record) {
      return {
        ...record.toObject(), // includes staffId with populated fields and status
      };
    } else {
      return {
        staffId: {
          _id: staff._id,
          fullName: staff.fullName,
          staffId: staff.staffId,
        },
        logs: [],
        status: 'Not Marked',
        date: today,
      };
    }
  });

  return new ApiResponse(200, attendance, 'Today attendance fetched successfully').send(res);
});

export const putHrAdjustment = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const { adjustments } = req.body;

  // Validate the inputs
  if (!['None', 'Half-day to Full-day', 'Absent to Half-day', 'Hourly'].includes(adjustments)) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'adjustments',
        message: 'Invalid adjustment type. Allowed: None/Half-day to Full-day/Absent to Half-day/Hourly',
      },
    ]);
  }

  const attendance = await Attendance.findById(id);
  if (!attendance) {
    throw new ApiError(404, "Attendance record doesn't exist.", [
      { field: 'id', message: 'Attendance record not found.' },
    ]);
  }

  // Status validation
  if (
    (adjustments === 'Present to Half-day' && attendance.status !== 'present') ||
    (adjustments === 'Hourly' && attendance.status !== 'present') ||
    (adjustments === 'Half-day to Full-day' && attendance.status !== 'half-day')
  ) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'adjustments',
        message: 'Invalid adjustment type for current status.',
      },
    ]);
  }

  attendance.hrAdjustments.adjustments = adjustments;
  attendance.hrAdjustments.adjustedBy = req.admin._id;
  await attendance.save();
  return new ApiResponse(200, attendance, 'HR adjustment updated successfully.').send(res);
});

export const getAllHolidayLeave = expressAsyncHandler(async (req, res) => {
  const holidayLeaves = await Leave.find({ office: req.admin.office, type: 'holidayLeave' })
    .populate('staff', 'fullName id')
    .sort('-date');
  return new ApiResponse(200, holidayLeaves, 'All holiday leave fetched successfully').send(res);
});

export const calculateAttendanceByDate = expressAsyncHandler(async (req, res) => {
  const { date } = req.params;
  if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'date',
        message: 'Invalid date format. Allowed: YYYY-MM-DD',
      },
    ]);
  }
  const qDate = new Date(date);
  qDate.setHours(0, 0, 0, 0);
  const currentDate = getCurrentDate();
  if (qDate > new Date(currentDate)) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'date',
        message: 'Date should not be in the future.',
      },
    ]);
  }

  const allStaff = await Staff.find({ office: req.admin.office }).select('_id office');
  console.log("All Staffs...",JSON.stringify(allStaff))
  for (const staff of allStaff) {
    await autoAttendanceCalculateByStaffId(staff.office, staff._id, qDate);
  }

  return new ApiResponse(200, null, 'Attendance calculated successfully.').send(res);
});

export const assignOffDayWork = expressAsyncHandler(async (req, res) => {
  const { staffId, date, workType, remarks, benefit = 'extraPay', linkedDate } = req.body;

  const staff = await Staff.findById(staffId);
  if (!staff) {
    throw new ApiError(404, 'Staff not found', [
      {
        field: 'staffId',
        message: 'Staff not found',
      },
    ]);
  }
  const formattedDate = formatDate(date, 'yyyy-MM-dd');
  const isHoliday = await Holiday.findOne({
    date: formattedDate,
    office: staff.office,
    $or: [{ department: staff.department }, { forAllDepartments: true }, { department: { $exists: false } }],
  });
  const isWeekOff = await WeekOff.findOne({
    date: formattedDate,
    office: staff.office,
    $or: [{ department: staff.department }, { forAllDepartments: true }, { department: { $exists: false } }],
  });
  if (!isHoliday && !isWeekOff) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'date',
        message: 'The selected date is not a holiday or week-off',
      },
    ]);
  }

  // Check for existing off-day work entry
  const existingEntry = await OffDayWork.findOne({ staff: staffId, date: formattedDate });
  if (existingEntry) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'date',
        message: 'An off-day work entry already exists for this staff on the selected date',
      },
    ]);
  }

  // Create new off-day work entry
  const offDayWork = await OffDayWork.create({
    office: staff.office,
    staff: staffId,
    date: formattedDate,
    workType,
    remarks,
    benefit,
    linkedDate,
  });

  return new ApiResponse(201, offDayWork, 'Off-day work assigned successfully').send(res);
});

export const getAllOffDayWorkAssigned = expressAsyncHandler(async (req, res) => {
  const offDayAssigments = await OffDayWork.find({ office: req.admin.office }).populate('staff', 'fullName staffId');
  return new ApiResponse(200, offDayAssigments, 'All off-day work assigned fetched successfully').send(res);
});
