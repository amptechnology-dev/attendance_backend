import { formatDate, addDays, subDays, isSameDay, differenceInCalendarDays, eachDayOfInterval } from 'date-fns';
import { Staff } from '../models/staff.model.js';
import { EntryExitLog } from '../models/entryExitLog.model.js';
import { Attendance } from '../models/attendance.model.js';
import { DutyTiming } from '../models/dutyTiming.model.js';
import { Holiday } from '../models/holiday.model.js';
import { WeekOff } from '../models/weekOff.model.js';
import { Leave } from '../models/leave.model.js';
import logger from '../config/logger.js';
import { getLocalMonthBoundariesFormatted } from '../utils/dateTime.utils.js';
import { OffDayWork } from '../models/offDayWork.model.js';

export const autoAttendanceCalculateByStaffId = async (office, staffId, date = new Date()) => {
  const currentDate = formatDate(date, 'yyyy-MM-dd');
  // Check if the date is a holiday or week-off
  const staff = await Staff.findOne({ _id: staffId, status: 'active', dateOfJoining: { $lte: currentDate } });
  if (!staff) return;

  const holiday = await Holiday.findOne({
    date: currentDate,
    office,
    $or: [{ forAllDepartments: true }, { department: staff.department }],
  });
  let weekOff = null;
  let isOffDayWorkAssigned = null;
  if (!holiday) {
    weekOff = await WeekOff.findOne({
      date: currentDate,
      office,
      $or: [{ forAllDepartments: true }, { department: staff.department }],
    });
  }

  if (holiday || weekOff) {
    const offDayType = holiday ? 'holiday' : 'week-off';
    isOffDayWorkAssigned = await OffDayWork.findOne({
      staff: staffId,
      date: currentDate,
    });

    if (!isOffDayWorkAssigned) {
      await Attendance.findOneAndUpdate(
        { staffId, date: currentDate },
        { office, status: offDayType, isOffDayWork: false },
        { upsert: true }
      );
      return;
    }
  }

  // Fetch logs for the staff for the current date
  const logs = await EntryExitLog.find({ staff: staffId, date: currentDate }).sort('+entryTime');

  if (!logs || logs.length === 0) {
    // If no logs exist, mark attendance as absent
    // Check leave application
    const leaveAccepted = await Leave.findOne({
      staff: staffId,
      dateFrom: { $lte: currentDate },
      dateTo: { $gte: currentDate },
      isPaid: true,
    });
    const paidLeave = leaveAccepted ? 'paid' : 'unpaid';

    await Attendance.findOneAndUpdate(
      { staffId, date: currentDate },
      { office, firstHalf: 'absent', secondHalf: 'absent', status: 'absent', leaveStatus: paidLeave },
      { upsert: true, new: true }
    );
    return;
  }

  const dutyTiming = await DutyTiming.findOne({ office, department: staff.department });
  if (!dutyTiming) return;
  const firstHalfStart = new Date(`${currentDate}T${dutyTiming.startTime}+05:30`);
  const firstHalfEnd = new Date(`${currentDate}T${dutyTiming.firstHalfEnd}+05:30`);
  const secondHalfStart = new Date(`${currentDate}T${dutyTiming.secondHalfStart}+05:30`);
  const dayEnd = new Date(`${currentDate}T${dutyTiming.endTime}+05:30`);

  // Check if late entry
  let isLate = false;
  if (logs[0].entryTime > firstHalfStart) {
    isLate = true;
  }
  // Check if late entry is allowed
  let allowedLate = false;
  if (isLate) {
    allowedLate = await canAllowLateEntry(
      staffId,
      logs[0].entryTime,
      firstHalfStart,
      dutyTiming?.lateAllowed,
      dutyTiming?.lateEntryTime
    );
  }

  if (logs.length === 1 && !logs[0].exitTime) {
    // Check if the staff has missed off days
    // const lastAttendance = await Attendance.findOne({
    //   staffId,
    //   date: { $lt: currentDate },
    //   status: { $nin: ['absent', 'week-off', 'holiday'] },
    // }).sort('-date');

    // if (lastAttendance && differenceInCalendarDays(new Date(currentDate), lastAttendance.date) > 1) {
    //   await markMissedOffDaysAsLeave(staffId, office, staff.department, lastAttendance.date, new Date(currentDate));
    // }

    // If only one log exists and it is an entry log, mark attendance as present
    await Attendance.findOneAndUpdate(
      { staffId, date: currentDate },
      {
        office,
        firstHalf: 'absent',
        secondHalf: 'absent',
        status: 'present',
        logs: [logs[0]._id],
        isLate,
        allowedLate,
      },
      { upsert: true, new: true }
    );
    return;
  }

  // Calculate total work time and breaks
  let totalWorkTime = 0;
  let breakTime = 0;

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (log.exitTime) {
      totalWorkTime += (new Date(log.exitTime) - new Date(log.entryTime)) / (1000 * 60); // Convert to minutes
    }

    if (i < logs.length - 1) {
      const nextLog = logs[i + 1];
      breakTime += (new Date(nextLog.entryTime) - new Date(log.exitTime)) / (1000 * 60);
    }
  }

  // Check if first and second halves are covered
  const firstHalfWorked = logs.some(
    (log) => (log.entryTime <= firstHalfStart || allowedLate) && log.exitTime >= firstHalfEnd
  );
  const secondHalfWorked = logs.some((log) => log.entryTime <= secondHalfStart && log.exitTime >= dayEnd);

  // Calculate attendance status
  const firstHalf = firstHalfWorked ? 'present' : 'absent';
  const secondHalf = secondHalfWorked ? 'present' : 'absent';

  const status =
    firstHalf === 'present' && secondHalf === 'present'
      ? 'full-day'
      : firstHalf === 'present' || secondHalf === 'present'
        ? 'half-day'
        : 'present';

  // Handle off-day work validation if assigned
  let isOffDayValid = false;
  if (isOffDayWorkAssigned) {
    const { workType: requiredWorkType } = isOffDayWorkAssigned;

    if (requiredWorkType === 'hourly') {
      // For hourly work type, always consider it valid as pay is based on hours worked
      isOffDayValid = true;
    } else if (requiredWorkType === 'full-day') {
      isOffDayValid = status === 'full-day';
    } else if (requiredWorkType === 'half-day') {
      isOffDayValid = status === 'half-day' || status === 'full-day';
    }

    // Update the offDayWork document with validation status
    // await OffDayWork.findByIdAndUpdate(isOffDayWorkAssigned._id, {
    //   $set: {
    //     isWorked: isOffDayValid,
    //     actualWorkType: status,
    //   },
    // });
  }

  const attendance = await Attendance.findOneAndUpdate(
    { staffId, date: currentDate },
    {
      office,
      firstHalf,
      secondHalf,
      status,
      totalWorkTime,
      breakTime,
      logs: logs.map((log) => log._id),
      isLate,
      allowedLate,
      ...(isOffDayWorkAssigned && {
        isOffDayWork: true,
        offDayAssignmentId: isOffDayWorkAssigned._id,
        validOffDayWork: isOffDayValid,
      }),
    },
    { upsert: true, new: true }
  );
  // Check if the staff has missed off days
  const lastAttendance = await Attendance.findOne({
    staffId,
    date: { $lt: currentDate },
    status: { $nin: ['absent', 'week-off', 'holiday'] },
  }).sort('-date');
  if (lastAttendance && differenceInCalendarDays(new Date(currentDate), lastAttendance.date) > 1) {
    await markMissedOffDaysAsLeave(staffId, office, staff.department, lastAttendance.date, new Date(currentDate));
  }

  return attendance;
};

/**
 * Marks off days (holidays and week-offs) between the last attendance and the current day as special leave.
 *
 * @param {ObjectId} staffId - The staff ID.
 * @param {ObjectId} office - The office ID.
 *  @param {ObjectId} department - The department ID. Needed for filtering
 * @param {Date} lastAttendanceDate - The last recorded attendance date.
 * @param {Date} currentDate - The current day when the staff clocks in.
 */
const markMissedOffDaysAsLeave = async (staffId, office, department, lastAttendanceDate, currentDate) => {
  // Calculate the gap: from the day after lastAttendanceDate to the day before currentDate.
  const gapStart = addDays(lastAttendanceDate, 1);
  const gapEnd = subDays(currentDate, 1);
  // Early abort if there is no gap.
  if (gapStart > gapEnd) return;

  // Check Attendance records for each day in the gap is processed.
  const middleDates = eachDayOfInterval({ start: gapStart, end: gapEnd });
  const processedCount = await Attendance.countDocuments({
    staffId,
    date: { $in: middleDates.map((d) => formatDate(d, 'yyyy-MM-dd')) },
  });
  // Early abort if all days are not processed.
  if (processedCount < middleDates.length) return;

  // Fetch all off days (holidays and week-offs) within the gap.
  const [holidays, weekOffs] = await Promise.all([
    Holiday.find({
      date: { $gte: gapStart, $lte: gapEnd },
      office,
      $or: [{ forAllDepartments: true }, { department }],
    }),
    WeekOff.find({
      date: { $gte: gapStart, $lte: gapEnd },
      office,
      $or: [{ forAllDepartments: true }, { department }],
    }),
  ]);
  // Combine and sort by date.
  const offDays = [...holidays, ...weekOffs];
  if (offDays.length === 0) return; // Abort if no off days found.

  offDays.sort((a, b) => a.date - b.date);
  const offDates = offDays.map((d) => d.date);

  // Determine expected adjacent working days:
  // Expected previous working day: one day before the first off day.
  const expectedPrev = subDays(offDates[0], 1);
  // Expected next working day: one day after the last off day.
  const expectedNext = addDays(offDates[offDates.length - 1], 1);
  // Check if adjacent days are present.
  const isPrevPresent = isSameDay(lastAttendanceDate, expectedPrev);
  const isNextPresent = isSameDay(currentDate, expectedNext);
  // Early abort if both adjacent days are present (i.e. no deduction needed).
  if (isPrevPresent && isNextPresent) return;

  // Determine the leave range: from the first off day to the last off day.
  const dateFrom = offDates[0];
  const dateTo = offDates[offDates.length - 1];

  // If both previous and next days are absent, all off days should be deducted.
  // Otherwise, only one day should be deducted.
  const leaveCount = !isPrevPresent && !isNextPresent ? offDates.length : 1;

  // Adjust the range based on the leave count:
  const finalDateFrom = leaveCount === 1 ? (isPrevPresent ? dateTo : dateFrom) : dateFrom;
  const finalDateTo = leaveCount === 1 ? (isNextPresent ? dateFrom : dateTo) : dateTo;

  // Check if leave already exists for this date range.
  const existingLeaves = await Leave.find({
    staff: staffId,
    office,
    dateFrom: { $lte: dateTo }, // Ensure it spans the date range
    dateTo: { $gte: dateFrom },
    type: 'holidayLeave', // Ensure the leave type is matched
  });
  // If leave already exists, abort.
  if (existingLeaves.length > 0) return;

  // Construct remarks for the leave
  const reason =
    leaveCount === 1
      ? `Absent on ${formatDate(isPrevPresent ? expectedNext : expectedPrev, 'dd-MM-yyyy')}`
      : `Absent for ${formatDate(expectedPrev, 'dd-MM-yyyy')} to ${formatDate(expectedNext, 'dd-MM-yyyy')}`;

  try {
    // Insert the leave record into the database.
    await Leave.create({
      staff: staffId,
      office,
      dateFrom: finalDateFrom,
      dateTo: finalDateTo,
      type: 'holidayLeave',
      noOfDays: leaveCount,
      status: 'applied',
      reason,
    });
  } catch (error) {
    logger.error('Error inserting special leave records:', error);
  }
};

/**
 *  Checks if late entry is allowed for a staff based on their attendance record and late allowance.
 *
 * @param {ObjectId} staffId - The staff ID.
 * @param {Date} entryTime - The entry time.
 * @param {Date} firstHalfStart - The default start time/entry time.
 * @param {number} [maxLateDays=4] - The maximum number of late days allowed.
 * @param {number} [lateAllowance=60] - The maximum late allowance in minutes.
 * @returns {Promise<boolean>} Returns `true` if late entry is allowed, `false` otherwise.
 */
const canAllowLateEntry = async (staffId, entryTime, firstHalfStart, maxLateDays = 4, lateAllowance = 60) => {
  const lateAllowanceMs = lateAllowance * 60 * 1000;
  // Check if entry time is  actually late
  if (entryTime <= firstHalfStart) return true;
  // Check if late entry is within allowed grace period
  if (entryTime > new Date(firstHalfStart.getTime() + lateAllowanceMs)) return false;

  const { startDate, endDate } = getLocalMonthBoundariesFormatted(entryTime);
  // Count how many times the staff has already used late allowance
  const lateDaysCount = await Attendance.countDocuments({
    staffId,
    allowedLate: true, // Only count days where late was allowed
    date: { $gte: startDate, $lte: endDate },
  });
  // Check if the staff has already exhausted their late allowance
  if (lateDaysCount >= maxLateDays) return false;

  return true; //  If all checks pass, allow late entry
};
