import { Overtime } from '../models/overtime.model.js';
import { SalaryStructure, Salary } from '../models/salary.model.js';
import { SalaryCalculation } from '../models/salaryCalculation.model.js';
import { assertSalaryNotLocked } from './salary.service.js';
import { Staff } from '../models/staff.model.js';
import { Attendance } from '../models/attendance.model.js';
import { DutyTiming } from '../models/dutyTiming.model.js';
import { Holiday } from '../models/holiday.model.js';
import { getMonthBoundariesFormatted } from '../utils/dateTime.utils.js';
import { getDaysInMonth, format } from 'date-fns';
import { ApiError } from '../utils/responseHandler.js';
import logger from '../config/logger.js';

const computeSlots = (exitTime, dutyEndDateTime, slotMinutes) => {
  const diffMinutes = (new Date(exitTime) - new Date(dutyEndDateTime)) / (1000 * 60);
  if (diffMinutes < slotMinutes) return 0;
  return Math.floor(diffMinutes / slotMinutes);
};

export const getOvertimeReport = async (officeId, month, year) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure?.overtime?.enabled) {
    throw new ApiError(400, 'Bad Request', 'Overtime is not enabled in Salary Structure settings.');
  }
  const { slotMinutes } = structure.overtime;
  const { startDate, endDate } = getMonthBoundariesFormatted(month, year);

  const lock = await SalaryCalculation.findOne({ office: officeId, month, year }).lean();
  const locked = Boolean(lock?.locked);

  const salaryRecords = await Salary.find({ office: officeId, month, year }).select('staff').lean();
  const calculatedStaffIds = new Set(salaryRecords.map((s) => String(s.staff)));

  if (!calculatedStaffIds.size) {
    throw new ApiError(
      400,
      'Bad Request',
      'Salary is not calculated on that month. 1st calculate salary then put overtime.'
    );
  }

  const [staffList, appliedList] = await Promise.all([
    Staff.find({ office: officeId, status: 'active', _id: { $in: [...calculatedStaffIds] } })
      .populate('department', 'name')
      .lean(),
    Overtime.find({ office: officeId, month, year }).lean(),
  ]);
  const appliedMap = new Map(appliedList.map((o) => [String(o.staff), o]));

  const dutyTimingCache = new Map();
  const dayTypeCache = new Map();
  const grouped = {};

  for (const staff of staffList) {
    const deptId = String(staff.department?._id || '');
    if (!dutyTimingCache.has(deptId)) {
      const dt = await DutyTiming.findOne({ office: officeId, department: staff.department?._id }).lean();
      dutyTimingCache.set(deptId, dt);
    }
    const dutyTiming = dutyTimingCache.get(deptId);
    if (!dutyTiming) continue;

    // আগে থেকে apply করা entries — date wise lookup এর জন্য map
    const applied = appliedMap.get(String(staff._id));
    const appliedEntriesMap = new Map((applied?.entries || []).map((e) => [e.date, e]));

    const attendances = await Attendance.find({
      office: officeId,
      staffId: staff._id,
      date: { $gte: startDate, $lte: endDate },
      $or: [
        { status: 'full-day', isOffDayWork: false },
        { status: { $in: ['present', 'half-day'] }, isOffDayWork: true },
      ],
    })
      .populate('logs')
      .lean();

    if (!attendances.length) continue;

    const dates = [];

    for (const att of attendances) {
      const dateStr = format(new Date(att.date), 'yyyy-MM-dd');

      const validLogs = (att.logs || []).filter((l) => l.entryTime || l.exitTime);
      const firstEntry = validLogs.length
        ? validLogs.reduce((earliest, l) =>
            l.entryTime && new Date(l.entryTime) < new Date(earliest.entryTime || l.entryTime) ? l : earliest
          )
        : null;
      const exitLogs = validLogs.filter((l) => l.exitTime);
      const lastExit = exitLogs.length
        ? exitLogs.reduce((latest, l) => (new Date(l.exitTime) > new Date(latest.exitTime) ? l : latest))
        : null;

      const entryTime = firstEntry?.entryTime || null;
      const exitTime = lastExit?.exitTime || null;

      if (att.isOffDayWork) {
        const cacheKey = `${dateStr}::${deptId}`;
        if (!dayTypeCache.has(cacheKey)) {
          const isHoliday = await Holiday.findOne({
            date: dateStr,
            office: officeId,
            $or: [{ forAllDepartments: true }, { department: staff.department?._id }],
          }).lean();
          dayTypeCache.set(cacheKey, isHoliday ? 'holiday' : 'week-off');
        }

        const appliedEntry = appliedEntriesMap.get(dateStr);
        dates.push({
          date: dateStr,
          slots: appliedEntry ? appliedEntry.slots : 0,
          source: 'manual',
          editable: true,
          dayType: dayTypeCache.get(cacheKey),
          entryTime,
          exitTime,
          alreadyApplied: Boolean(appliedEntry),
        });
        continue;
      }

      if (!lastExit) continue;
      const dutyEnd = new Date(`${dateStr}T${dutyTiming.endTime}+05:30`);
      const slots = computeSlots(lastExit.exitTime, dutyEnd, slotMinutes);
      if (slots > 0) {
        dates.push({
          date: dateStr,
          slots,
          source: 'auto',
          editable: false,
          dayType: null,
          entryTime,
          exitTime,
          alreadyApplied: appliedEntriesMap.has(dateStr),
        });
      }
    }

    if (!dates.length) continue;

    const departmentName = staff.department?.name || 'Unassigned';

    if (!grouped[departmentName]) grouped[departmentName] = [];
    grouped[departmentName].push({
      staffId: staff._id,
      staffName: staff.fullName,
      dates,
      totalSlots: dates.reduce((s, d) => s + d.slots, 0),
      alreadyApplied: Boolean(applied),
      appliedTotalSlots: applied?.totalSlots || 0,
      appliedAmount: applied?.amount || 0,
    });
  }

  return {
    locked,
    departments: Object.entries(grouped).map(([departmentName, staff]) => ({ departmentName, staff })),
  };
};

export const applyOvertime = async (officeId, month, year, adminId, selections) => {
  // Freeze হয়ে গেলে overtime apply করা যাবে না
  await assertSalaryNotLocked(officeId, month, year);

  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure?.overtime?.enabled) {
    throw new ApiError(400, 'Bad Request', 'Overtime is not enabled in Salary Structure settings.');
  }
  const { multiplier, slotMinutes } = structure.overtime;
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));

  const results = [];

  for (const sel of selections) {
    const staff = await Staff.findById(sel.staffId).lean();
    if (!staff || !staff.monthlySalary) continue;

    const totalSlots = (sel.dates || []).reduce((s, d) => s + (Number(d.slots) || 0), 0);

    const amount = totalSlots > 0 ? Math.round((staff.monthlySalary * totalSlots) / (daysInMonth * multiplier)) : 0;

    await Overtime.findOneAndUpdate(
      { office: officeId, staff: staff._id, month, year },
      {
        entries: sel.dates,
        totalSlots,
        amount,
        slotMinutes,
        multiplier,
        appliedBy: adminId,
        appliedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    const salary = await Salary.findOne({ office: officeId, staff: staff._id, month, year });
    if (!salary) {
      logger.warn(`Overtime applied but Salary not found for staff ${staff._id}, ${month}/${year}`);
      continue;
    }

    const oldOvertime = salary.breakdown?.overtime || 0;
    salary.breakdown.overtime = amount;
    salary.netSalary = Math.round((salary.netSalary || 0) - oldOvertime + amount);
    await salary.save();

    results.push({ staffId: staff._id, totalSlots, amount });
  }

  return results;
};
