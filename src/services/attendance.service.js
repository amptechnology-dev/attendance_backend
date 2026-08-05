import { formatDate, addDays, subDays, isSameDay, differenceInCalendarDays, eachDayOfInterval } from 'date-fns';
import { Staff } from '../models/staff.model.js';
import { EntryExitLog } from '../models/entryExitLog.model.js';
import { Attendance } from '../models/attendance.model.js';
import { DutyTiming } from '../models/dutyTiming.model.js';
import { Holiday } from '../models/holiday.model.js';
import { WeekOff } from '../models/weekOff.model.js';
import { Leave } from '../models/leave.model.js';
import logger from '../config/logger.js';
import { getLocalMonthBoundariesFormatted, getCurrentDate } from '../utils/dateTime.utils.js';
import { OffDayWork } from '../models/offDayWork.model.js';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { AttendanceCalculation } from '../models/attendanceCalculation.model.js';

const toMinutePrecision = (date) => {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
};

export const autoAttendanceCalculateByStaffId = async (office, staffId, date = new Date()) => {
  const currentDate = formatDate(date, 'yyyy-MM-dd');

  const staff = await Staff.findOne({ _id: staffId, status: 'active', dateOfJoining: { $lte: currentDate } });
  if (!staff) return;

  // ---------- Step 1: আজ কি Holiday / Week-off ----------
  const holiday = await Holiday.findOne({
    date: currentDate,
    office,
    $or: [{ forAllDepartments: true }, { department: staff.department }],
  });

  let weekOff = null;
  if (!holiday) {
    weekOff = await WeekOff.findOne({
      date: currentDate,
      office,
      $or: [{ forAllDepartments: true }, { department: staff.department }],
    });
  }
  const isOffDay = Boolean(holiday || weekOff);
  const offDayType = holiday ? 'holiday' : 'week-off';

  // ---------- Step 2: EntryExitLog আগে fetch করো ----------
  const startOfDay = new Date(`${currentDate}T00:00:00.000+05:30`);
  const endOfDay = new Date(`${currentDate}T23:59:59.999+05:30`);

  const logs = await EntryExitLog.find({
    staff: staffId,
    date: { $gte: startOfDay, $lte: endOfDay },
  }).sort({ entryTime: 1 });

  // ---------- Step 3: Off-day (Holiday/Week-off) কিন্তু কোনো log নেই ----------
  if (isOffDay && (!logs || logs.length === 0)) {
    await Attendance.findOneAndUpdate(
      { staffId, date: currentDate },
      { office, status: offDayType, isOffDayWork: false, firstHalf: 'absent', secondHalf: 'absent' },
      { upsert: true, new: true }
    );
    return;
  }

  // ---------- Step 4: সাধারণ working day কিন্তু কোনো log নেই => Absent ----------
  if (!isOffDay && (!logs || logs.length === 0)) {
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

  // এখান থেকে logs.length > 0 নিশ্চিত (staff কাজ করেছে — normal day অথবা off-day work)
  const isOffDayWorkAssigned = isOffDay ? await OffDayWork.findOne({ staff: staffId, date: currentDate }) : null;

  const dutyTiming = await DutyTiming.findOne({ office, department: staff.department });
  if (!dutyTiming) return;

  const firstHalfStart = new Date(`${currentDate}T${dutyTiming.startTime}+05:30`);
  const firstHalfEnd = new Date(`${currentDate}T${dutyTiming.firstHalfEnd}+05:30`);
  const secondHalfStart = new Date(`${currentDate}T${dutyTiming.secondHalfStart}+05:30`);
  const dayEnd = new Date(`${currentDate}T${dutyTiming.endTime}+05:30`);

  // ---------- Late entry check (শুধু normal working day-তে প্রযোজ্য) ----------
  let isLate = false;
  let allowedLate = false;
  if (!isOffDay) {
    isLate = toMinutePrecision(logs[0].entryTime) > toMinutePrecision(firstHalfStart);
    if (isLate) {
      allowedLate = await canAllowLateEntry(
        staffId,
        logs[0].entryTime,
        firstHalfStart,
        currentDate,
        dutyTiming?.lateAllowed,
        dutyTiming?.lateEntryTime
      );
    }
  }

  // ---------- শুধু Entry হয়েছে, এখনো Exit হয়নি (interim state) ----------
  if (logs.length === 1 && !logs[0].exitTime) {
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
        // FIX: entry হওয়া মাত্রই যদি এটা off-day হয়, isOffDayWork সাথে সাথেই true —
        // পুরো day complete হওয়ার জন্য অপেক্ষা করতে হবে না, নাহলে exit করার আগে
        // কেউ interim state-এ থেকে গেলে এই flag miss হয়ে যেতে পারত।
        ...(isOffDay && { isOffDayWork: true }),
      },
      { upsert: true, new: true }
    );
    return;
  }

  // ---------- Total work time & break time ----------
  let totalWorkTime = 0;
  let breakTime = 0;
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (log.exitTime) {
      totalWorkTime += (new Date(log.exitTime) - new Date(log.entryTime)) / (1000 * 60);
    }
    if (i < logs.length - 1) {
      const nextLog = logs[i + 1];
      breakTime += (new Date(nextLog.entryTime) - new Date(log.exitTime)) / (1000 * 60);
    }
  }

  let firstHalf, secondHalf, status;

  if (isOffDay) {
    // Scenario 7: Holiday/Week-off এ কাজ করলে => সবসময় Present
    firstHalf = 'present';
    secondHalf = 'present';
    status = 'present';
  } else {
    // ---------- Normal working day — Scenario 1-6 ----------
    const firstHalfWorked = logs.some(
      (log) =>
        (toMinutePrecision(log.entryTime) <= toMinutePrecision(firstHalfStart) || allowedLate) &&
        log.exitTime &&
        toMinutePrecision(log.exitTime) >= toMinutePrecision(firstHalfEnd)
    );
    const secondHalfWorked = logs.some(
      (log) =>
        toMinutePrecision(log.entryTime) <= toMinutePrecision(secondHalfStart) &&
        log.exitTime &&
        toMinutePrecision(log.exitTime) >= toMinutePrecision(dayEnd)
    );

    firstHalf = firstHalfWorked ? 'present' : 'absent';
    secondHalf = secondHalfWorked ? 'present' : 'absent';

    status =
      firstHalf === 'present' && secondHalf === 'present'
        ? 'full-day'
        : firstHalf === 'present' || secondHalf === 'present'
          ? 'half-day'
          : 'present';
  }

  // ---------- Off-day work benefit validity (assignment থাকলে — শুধুমাত্র formal validation-এর জন্য) ----------
  let isOffDayValid = false;
  if (isOffDayWorkAssigned) {
    const { workType: requiredWorkType } = isOffDayWorkAssigned;
    const fullDayMinutes = (dayEnd - firstHalfStart) / (1000 * 60) - breakTime;
    if (requiredWorkType === 'hourly') {
      isOffDayValid = true;
    } else if (requiredWorkType === 'full-day') {
      isOffDayValid = totalWorkTime >= fullDayMinutes * 0.9;
    } else if (requiredWorkType === 'half-day') {
      isOffDayValid = totalWorkTime >= fullDayMinutes * 0.4;
    }
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
      // FIX (root cause): isOffDayWork এখন শুধু "আজ off-day ছিল এবং staff কাজ করেছে"
      // এর উপর নির্ভর করে সেট হবে — formal OffDayWork assignment থাকা-না-থাকার উপর নয়।
      // offDayAssignmentId / validOffDayWork আলাদা জিনিস — সেগুলো শুধু formal assignment
      // থাকলেই সেট হবে (approval/validation-এর জন্য), isOffDayWork-এর pre-condition না।
      ...(isOffDay && {
        isOffDayWork: true,
        ...(isOffDayWorkAssigned && {
          offDayAssignmentId: isOffDayWorkAssigned._id,
          validOffDayWork: isOffDayValid,
        }),
      }),
    },
    { upsert: true, new: true }
  );

  // ---------- Missed off-day leave check (অপরিবর্তিত) ----------
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
 */
const markMissedOffDaysAsLeave = async (staffId, office, department, lastAttendanceDate, currentDate) => {
  const gapStart = addDays(lastAttendanceDate, 1);
  const gapEnd = subDays(currentDate, 1);
  if (gapStart > gapEnd) return;

  const middleDates = eachDayOfInterval({ start: gapStart, end: gapEnd });
  const processedCount = await Attendance.countDocuments({
    staffId,
    date: { $in: middleDates.map((d) => formatDate(d, 'yyyy-MM-dd')) },
  });
  if (processedCount < middleDates.length) return;

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
  const offDays = [...holidays, ...weekOffs];
  if (offDays.length === 0) return;

  offDays.sort((a, b) => a.date - b.date);
  const offDates = offDays.map((d) => d.date);

  const expectedPrev = subDays(offDates[0], 1);
  const expectedNext = addDays(offDates[offDates.length - 1], 1);
  const isPrevPresent = isSameDay(lastAttendanceDate, expectedPrev);
  const isNextPresent = isSameDay(currentDate, expectedNext);
  if (isPrevPresent && isNextPresent) return;

  const dateFrom = offDates[0];
  const dateTo = offDates[offDates.length - 1];

  const leaveCount = !isPrevPresent && !isNextPresent ? offDates.length : 1;

  const finalDateFrom = leaveCount === 1 ? (isPrevPresent ? dateTo : dateFrom) : dateFrom;
  const finalDateTo = leaveCount === 1 ? (isNextPresent ? dateFrom : dateTo) : dateTo;

  const existingLeaves = await Leave.find({
    staff: staffId,
    office,
    dateFrom: { $lte: dateTo },
    dateTo: { $gte: dateFrom },
    type: 'holidayLeave',
  });
  if (existingLeaves.length > 0) return;

  const reason =
    leaveCount === 1
      ? `Absent on ${formatDate(isPrevPresent ? expectedNext : expectedPrev, 'dd-MM-yyyy')}`
      : `Absent for ${formatDate(expectedPrev, 'dd-MM-yyyy')} to ${formatDate(expectedNext, 'dd-MM-yyyy')}`;

  try {
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


const canAllowLateEntry = async (
  staffId,
  entryTime,
  firstHalfStart,
  currentDate,
  maxLateDays = 4,
  lateAllowance = 60
) => {
  const lateAllowanceMs = lateAllowance * 60 * 1000;
  const entry = toMinutePrecision(entryTime);
  const start = toMinutePrecision(firstHalfStart);
  // আসলেই late কিনা
  if (entry <= start) return true;
  // Grace period (e.g. 60 min) এর বাইরে হলে সরাসরি না (কোনো quota তেই allow না)
  if (entry > toMinutePrecision(new Date(start.getTime() + lateAllowanceMs))) return false;

  const { startDate } = getLocalMonthBoundariesFormatted(entryTime);
  // FIX: শুধু আজকের আগের দিনগুলো count হবে, পুরো মাস না
  const lateDaysCount = await Attendance.countDocuments({
    staffId,
    allowedLate: true,
    date: { $gte: startDate, $lt: currentDate },
  });
  if (lateDaysCount >= maxLateDays) return false;

  return true;
};

export const getMissingAttendanceDates = async (office, month, year) => {
  const now = new Date();

  const selectedMonth = month ? Number(month) - 1 : now.getMonth();
  const selectedYear = year ? Number(year) : now.getFullYear();

  const requestedDate = new Date(selectedYear, selectedMonth, 1);
  const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);

  // Future month
  if (requestedDate > currentMonthDate) {
    return [];
  }

  const startDate = startOfMonth(requestedDate);

  let endDate = endOfMonth(requestedDate);

  // Current month => Yesterday পর্যন্ত
  if (
    selectedMonth === now.getMonth() &&
    selectedYear === now.getFullYear()
  ) {
    endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);
  }

  const calculations = await AttendanceCalculation.find({
    office,
    locked: true,
    date: {
      $gte: startDate,
      $lte: endDate,
    },
  }).select('date');

  const calculatedDates = new Set(
    calculations.map((item) =>
      format(new Date(item.date), 'yyyy-MM-dd')
    )
  );

  const allDates = eachDayOfInterval({
    start: startDate,
    end: endDate,
  });

  const response = [];

  for (const day of allDates) {
    const formattedDate = format(day, 'yyyy-MM-dd');

    if (!calculatedDates.has(formattedDate)) {
      response.push({
        date: formattedDate,
      });
    }
  }

  return response;
};