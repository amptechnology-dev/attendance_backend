import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { Attendance } from '../models/attendance.model.js';
import { Leave } from '../models/leave.model.js';
import { Staff } from '../models/staff.model.js';
import { autoAttendanceCalculateByStaffId, getMissingAttendanceDates } from '../services/attendance.service.js';
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
import { AttendanceCalculation } from '../models/attendanceCalculation.model.js';

export const getAttendanceLogs = expressAsyncHandler(async (req, res) => {
  const { startDate, endDate, date, days, limit, search } = req.query;
  const user = req.admin;

  const filters = {
    office: user.office,
  };

  // Single Date Filter
  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    filters.date = {
      $gte: start,
      $lte: end,
    };
  }
  // Date Range Filter
  else {
    if (startDate) {
      filters.date = {
        ...(filters.date || {}),
        $gte: new Date(startDate),
      };
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      filters.date = {
        ...(filters.date || {}),
        $lte: end,
      };
    }
  }

  // Last X Days
  if (days) {
    const currentDate = getCurrentDate();

    filters.date = {
      ...(filters.date || {}),
      $gte: subDays(new Date(currentDate), Number(days)),
    };
  }

  let staffMatchFilter = {};

  // Permission Check
  const hasFullAccess =
    user.role?.permissions?.includes(permissions.ALL) ||
    user.role?.permissions?.includes(permissions.VIEW_ALL_ATTENDANCE);

  if (!hasFullAccess) {
    staffMatchFilter.department = user.department;
  }

  // Staff Search
  if (search) {
    const staffQuery = {
      office: user.office,
      fullName: {
        $regex: search,
        $options: 'i',
      },
    };

    if (!hasFullAccess) {
      staffQuery.department = user.department;
    }

    const staffs = await Staff.find(staffQuery).select('_id');

    staffMatchFilter.staffId = {
      $in: staffs.map((staff) => staff._id),
    };
  } else if (!hasFullAccess) {
    const staffs = await Staff.find({
      office: user.office,
      department: user.department,
    }).select('_id');

    staffMatchFilter.staffId = {
      $in: staffs.map((staff) => staff._id),
    };
  }

  const attendances = await Attendance.find({
    ...filters,
    ...staffMatchFilter,
  })
    .populate('staffId', 'fullName staffId')
    .populate('logs')
    .sort({ date: -1, createdAt: -1 })
    .limit(limit && !isNaN(Number(limit)) ? Number(limit) : undefined);

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

  if (
    ![
      'None',
      'Half-day to Full-day',
      'Present to Half-day',
      'Hourly',
      'Present to Full-day',
      'Absent to Half-day',
      'Absent to Full-day',
      'Present to Absent',
      'Half-day to Absent',
      'Full-day to Absent',
    ].includes(adjustments)
  ) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'adjustments',
        message:
          'Invalid adjustment type. Allowed: None/Half-day to Full-day/Present to Half-day/Hourly/Present to Full-day/Absent to Half-day/Absent to Full-day/Present to Absent/Half-day to Absent/Full-day to Absent',
      },
    ]);
  }

  const attendance = await Attendance.findById(id);

  if (!attendance) {
    throw new ApiError(404, "Attendance record doesn't exist.", [
      {
        field: 'id',
        message: 'Attendance record not found.',
      },
    ]);
  }

  // ==============================
  // Attendance Calculation Check
  // ==============================
  const startOfDay = new Date(attendance.date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(attendance.date);
  endOfDay.setHours(23, 59, 59, 999);

  const attendanceLock = await AttendanceCalculation.findOne({
    office: attendance.office,
    date: {
      $gte: startOfDay,
      $lte: endOfDay,
    },
    locked: true,
  });

  if (!attendanceLock) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'date',
        message: `Attendance has not been calculated for ${attendance.date.toISOString().slice(0, 10)}. Please calculate attendance first.`,
      },
    ]);
  }

  // FIX: Leave/Week-off/Holiday-তে কাজ করা দিনে HR adjustment করা যাবে না
  if (attendance.isOffDayWork) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'adjustments',
        message: `Attendance dated ${attendance.date.toISOString().slice(0, 10)} is an off-day-work (leave/week-off/holiday) record and cannot be HR-adjusted.`,
      },
    ]);
  }

  // Status validation
  if (
    (adjustments === 'Present to Half-day' && attendance.status !== 'present') ||
    (adjustments === 'Hourly' && attendance.status !== 'present') ||
    (adjustments === 'Half-day to Full-day' && attendance.status !== 'half-day') ||
    (adjustments === 'Present to Full-day' && attendance.status !== 'present') ||
    (adjustments === 'Absent to Half-day' && attendance.status !== 'absent') ||
    (adjustments === 'Absent to Full-day' && attendance.status !== 'absent') ||
    (adjustments === 'Present to Absent' && attendance.status !== 'present') ||
    (adjustments === 'Half-day to Absent' && attendance.status !== 'half-day') ||
    (adjustments === 'Full-day to Absent' && attendance.status !== 'full-day')
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

export const getMonthlyAttendanceByAttendanceId = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find the selected attendance
  const attendance = await Attendance.findById(id);

  if (!attendance) {
    throw new ApiError(404, "Attendance record doesn't exist.", [
      {
        field: 'id',
        message: 'Attendance record not found.',
      },
    ]);
  }

  // Get month start & end
  const attendanceDate = new Date(attendance.date);

  const startOfMonth = new Date(attendanceDate.getFullYear(), attendanceDate.getMonth(), 1);
  startOfMonth.setHours(0, 0, 0, 0);

  const endOfMonth = new Date(attendanceDate.getFullYear(), attendanceDate.getMonth() + 1, 0);
  endOfMonth.setHours(23, 59, 59, 999);

  // Fetch all attendance of same staff for that month
  const monthlyAttendance = await Attendance.find({
    office: attendance.office,
    staffId: attendance.staffId,
    date: {
      $gte: startOfMonth,
      $lte: endOfMonth,
    },
  })
    .select('_id date status hrAdjustments.adjustments')
    .sort({ date: 1 });

  return new ApiResponse(200, monthlyAttendance, 'Monthly attendance fetched successfully.').send(res);
});

export const bulkHrAdjustment = expressAsyncHandler(async (req, res) => {
  const { attendanceIds, adjustments } = req.body;

  // ==============================
  // Validation
  // ==============================
  if (
    ![
      'None',
      'Half-day to Full-day',
      'Present to Half-day',
      'Hourly',
      'Present to Full-day',
      'Absent to Half-day',
      'Absent to Full-day',
      'Present to Absent',
      'Half-day to Absent',
      'Full-day to Absent',
    ].includes(adjustments)
  ) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'adjustments',
        message:
          'Invalid adjustment type. Allowed: None/Half-day to Full-day/Present to Half-day/Hourly/Present to Full-day/Absent to Half-day/Absent to Full-day/Present to Absent/Half-day to Absent/Full-day to Absent',
      },
    ]);
  }

  if (!Array.isArray(attendanceIds) || attendanceIds.length === 0) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'attendanceIds',
        message: 'Please select at least one attendance record.',
      },
    ]);
  }

  // ==============================
  // Fetch Attendances
  // ==============================
  const attendances = await Attendance.find({
    _id: { $in: attendanceIds },
  });

  if (attendances.length !== attendanceIds.length) {
    throw new ApiError(404, 'Validation Failed!', [
      {
        field: 'attendanceIds',
        message: 'One or more attendance records were not found.',
      },
    ]);
  }

  // ==============================
  // Validate each attendance
  // ==============================
  for (const attendance of attendances) {
    // Attendance Calculation Check
    const startOfDay = new Date(attendance.date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(attendance.date);
    endOfDay.setHours(23, 59, 59, 999);

    const attendanceLock = await AttendanceCalculation.findOne({
      office: attendance.office,
      date: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
      locked: true,
    });

    if (!attendanceLock) {
      throw new ApiError(400, 'Validation Failed!', [
        {
          field: 'date',
          message: `Attendance has not been calculated for ${attendance.date.toISOString().slice(0, 10)}.`,
        },
      ]);
    }

    // FIX: Leave/Week-off/Holiday-তে কাজ করা দিনে HR adjustment করা যাবে না —
    // এই দিনগুলো এমনিতেই full-pay হিসেবে count হয়, এতে টাচ করলে সেই guarantee ভেঙে যায়।
    if (attendance.isOffDayWork) {
      throw new ApiError(400, 'Validation Failed!', [
        {
          field: 'adjustments',
          message: `Attendance dated ${attendance.date.toISOString().slice(0, 10)} is an off-day-work (leave/week-off/holiday) record and cannot be HR-adjusted.`,
        },
      ]);
    }

    // Status validation
    if (
      (adjustments === 'Present to Half-day' && attendance.status !== 'present') ||
      (adjustments === 'Hourly' && attendance.status !== 'present') ||
      (adjustments === 'Half-day to Full-day' && attendance.status !== 'half-day') ||
      (adjustments === 'Present to Full-day' && attendance.status !== 'present') ||
      (adjustments === 'Absent to Half-day' && attendance.status !== 'absent') ||
      (adjustments === 'Absent to Full-day' && attendance.status !== 'absent') ||
      (adjustments === 'Present to Absent' && attendance.status !== 'present') ||
      (adjustments === 'Half-day to Absent' && attendance.status !== 'half-day') ||
      (adjustments === 'Full-day to Absent' && attendance.status !== 'full-day')
    ) {
      throw new ApiError(400, 'Validation Failed!', [
        {
          field: 'adjustments',
          message: `Invalid adjustment for attendance dated ${attendance.date.toISOString().slice(0, 10)}.`,
        },
      ]);
    }
  }

  // ==============================
  // Update all attendances
  // ==============================
  await Attendance.updateMany(
    {
      _id: { $in: attendanceIds },
    },
    {
      $set: {
        'hrAdjustments.adjustments': adjustments,
        'hrAdjustments.adjustedBy': req.admin._id,
      },
    }
  );

  const updatedAttendances = await Attendance.find({
    _id: { $in: attendanceIds },
  });

  return new ApiResponse(200, updatedAttendances, 'HR adjustments updated successfully.').send(res);
});


export const getAllHolidayLeave = expressAsyncHandler(async (req, res) => {
  const holidayLeaves = await Leave.find({ office: req.admin.office, type: 'holidayLeave' })
    .populate('staff', 'fullName id')
    .sort('-date');
  return new ApiResponse(200, holidayLeaves, 'All holiday leave fetched successfully').send(res);
});

export const calculateAttendanceByDate = expressAsyncHandler(async (req, res) => {
  const { date } = req.params;

  // Validate Date
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

  const attendanceCalculation = await AttendanceCalculation.findOne({
    office: req.admin.office,
    date: qDate,
    locked: true,
  });

  if (attendanceCalculation) {
    throw new ApiError(400, `Attendance already calculated for ${date}.`);
  }

  const allStaff = await Staff.find({
    office: req.admin.office,
  }).select('_id office');

  const failedStaff = [];

  for (const staff of allStaff) {
    try {
      await autoAttendanceCalculateByStaffId(staff.office, staff._id, qDate);
    } catch (error) {
      console.error(`[Attendance][calculate-by-date] Failed for staffId=${staff._id}, date=${date}:`, error.message);

      failedStaff.push({
        staffId: staff._id,
        error: error.message,
      });
    }
  }

  if (failedStaff.length > 0) {
    console.warn(
      `[Attendance][calculate-by-date] ${failedStaff.length}/${allStaff.length} staff failed on ${date}:`,
      failedStaff
    );
  }

  if (failedStaff.length === 0) {
    await AttendanceCalculation.create({
      office: req.admin.office,
      date: qDate,
      locked: true,
      calculatedBy: req.admin._id,
    });
  }

  return new ApiResponse(
    200,
    {
      total: allStaff.length,
      failed: failedStaff.length,
      failedStaff,
    },
    failedStaff.length > 0
      ? `Attendance calculated with ${failedStaff.length} failure(s).`
      : 'Attendance calculated successfully.'
  ).send(res);
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

export const getMissingAttendanceReport = expressAsyncHandler(async (req, res) => {
  const { month, year } = req.query;
  const data = await getMissingAttendanceDates(req.admin.office, month, year);
  return new ApiResponse(200, data, 'Missing attendance report fetched successfully').send(res);
});
