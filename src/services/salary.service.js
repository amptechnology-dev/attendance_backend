import { Salary, SalaryStructure, AdvanceTransaction } from '../models/salary.model.js';
import { Staff } from '../models/staff.model.js';
import { SalaryCalculation } from '../models/salaryCalculation.model.js';
import { Attendance } from '../models/attendance.model.js';
import { DutyTiming } from '../models/dutyTiming.model.js';
import { getDaysInMonth } from 'date-fns';
import logger from '../config/logger.js';
import { jsPDF } from 'jspdf';
import ExcelJS from 'exceljs';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { Leave } from '../models/leave.model.js';
import { HolidayFund } from '../models/holidayFund.model.js';
import { Office } from '../models/office.model.js';
import { getMonthBoundariesFormatted } from '../utils/dateTime.utils.js';
import { ApiError } from '../utils/responseHandler.js';
import { Admin } from '../models/admin.model.js';
import axios from 'axios';

const sumAmount = (list) => list.reduce((sum, t) => sum + (t.amount || 0), 0);

async function reverseAdvanceDeductionForMonth(staff, month, year) {
  const latestAdd = await AdvanceTransaction.findOne({ staff: staff._id, type: 'add' }).sort({ createdAt: -1 }).lean();

  const deductions = await AdvanceTransaction.find({
    staff: staff._id,
    type: 'deduct',
    month,
    year,
  }).lean();

  // Shudhu current advance-er deduction reverse hobe (purono advance er na)
  const toReverse = deductions.filter((t) => !latestAdd || new Date(t.createdAt) >= new Date(latestAdd.createdAt));
  if (!toReverse.length) return 0;

  const total = sumAmount(toReverse);
  if (total <= 0) return 0;

  // Last installment kete advance record muche gele, abar toiri kori
  if (!staff.advanceSalary) {
    if (!latestAdd) return 0;
    staff.advanceSalary = {
      totalAmount: latestAdd.amount,
      remainingAmount: 0,
      remainingMonths: 0,
      monthlyDeduction: toReverse[0].amount,
      dateTaken: latestAdd.dateTaken || latestAdd.createdAt,
      startMonth: latestAdd.startMonth,
      startYear: latestAdd.startYear,
      pausedMonths: [],
      remarks: latestAdd.remarks,
    };
  }

  const adv = staff.advanceSalary;
  adv.remainingAmount = (adv.remainingAmount || 0) + total;
  adv.remainingMonths = (adv.remainingMonths || 0) + toReverse.length;
  if (!adv.monthlyDeduction) {
    adv.monthlyDeduction = Math.ceil(adv.remainingAmount / adv.remainingMonths);
  }

  await AdvanceTransaction.deleteMany({ _id: { $in: toReverse.map((t) => t._id) } });

  return total;
}

/**
 * Already-calculated payslip theke advance deduction bad dey, TD ar Net update kore.
 */
async function removeAdvanceFromPayslip(officeId, staffId, month, year, amount) {
  const salary = await Salary.findOne({ office: officeId, staff: staffId, month, year }).lean();
  if (!salary) return;

  const current = salary.breakdown?.advanceDeduction ?? 0;
  if (current <= 0) return;

  const cut = Math.min(current, amount);
  const newAdvance = current - cut;
  const newDeductions = Math.max(0, Math.round((salary.deductions ?? 0) - cut));
  const newNet = Math.round(salary.grossSalary - newDeductions);

  const update = { $set: { deductions: newDeductions, netSalary: newNet } };
  if (newAdvance > 0) {
    update.$set['breakdown.advanceDeduction'] = newAdvance;
  } else {
    update.$unset = { 'breakdown.advanceDeduction': '' };
  }

  await Salary.updateOne({ _id: salary._id }, update);
}

export const assertSalaryNotLocked = async (officeId, month, year) => {
  const lock = await SalaryCalculation.findOne({ office: officeId, month, year, locked: true });
  if (lock) {
    throw new ApiError(400, 'Bad Request', `Salary for ${month}/${year} is frozen. No further changes allowed.`);
  }
};

export const freezeSalary = async (officeId, month, year, adminId) => {
  const salaryExists = await Salary.exists({ office: officeId, month, year });
  if (!salaryExists) {
    throw new ApiError(400, 'Bad Request', 'Cannot freeze salary before it has been calculated for this month.');
  }
  const lock = await SalaryCalculation.findOneAndUpdate(
    { office: officeId, month, year },
    { office: officeId, month, year, locked: true, calculatedBy: adminId },
    { upsert: true, new: true }
  );
  return lock;
};

export const getSalaryFreezeStatus = async (officeId, month, year) => {
  const lock = await SalaryCalculation.findOne({ office: officeId, month, year }).lean();
  return { locked: Boolean(lock?.locked) };
};

const sendUnfreezeOtpSms = async (mobile, otp, officeId) => {
  const message = `${otp} is your OTP to unfreeze salary in AMP Attendance. Please do not share this OTP with anyone.- AMPTECH`;
  const params = {
    username: 'MTECHTRANS',
    apikey: '38892-B2424',
    apirequest: 'Text',
    sender: 'AMPTCH',
    mobile,
    message,
    route: 'TRANS',
    TemplateID: '1407172715834228636',
    format: 'JSON',
  };
  const smsResponse = await axios.get('http://text.mboxsolution.com/sms-panel/api/http/index.php', { params });
  await Office.updateOne({ _id: officeId }, { $inc: { smsCount: 1 } });
  if (smsResponse.data.status !== 'success') {
    console.error('Failed to send unfreeze OTP SMS:', smsResponse.data);
    throw new ApiError(500, 'Failed to send SMS.', [{ message: 'Failed to send SMS' }]);
  }
};

export const requestSalaryUnfreezeOtp = async (officeId, adminId, month, year) => {
  const lock = await SalaryCalculation.findOne({ office: officeId, month, year });
  if (!lock?.locked) {
    throw new ApiError(400, 'Bad Request', `Salary for ${month}/${year} is not frozen.`);
  }

  const admin = await Admin.findById(adminId);
  if (!admin) throw new ApiError(404, 'Not Found!', 'Admin not found.');

  const otp = Math.floor(100000 + Math.random() * 900000);
  admin.otp = otp;
  admin.otpExpires = Date.now() + 5 * 60 * 1000; // 5 min
  admin.otpPurpose = 'unfreeze';
  admin.otpContext = `${month}:${year}`;
  await admin.save();

  await sendUnfreezeOtpSms(admin.mobile, otp, officeId);

  return { mobile: admin.mobile };
};

export const verifySalaryUnfreezeOtp = async (officeId, adminId, month, year, otp) => {
  const admin = await Admin.findById(adminId);
  if (!admin) throw new ApiError(404, 'Not Found!', 'Admin not found.');

  const isValid =
    admin.otpPurpose === 'unfreeze' &&
    admin.otpContext === `${month}:${year}` &&
    admin.otp &&
    admin.otp == otp &&
    admin.otpExpires &&
    admin.otpExpires > Date.now();

  if (!isValid) {
    throw new ApiError(400, 'Bad Request', 'Invalid or expired OTP.');
  }

  admin.otp = null;
  admin.otpExpires = null;
  admin.otpPurpose = undefined;
  admin.otpContext = undefined;
  await admin.save();

  const lock = await SalaryCalculation.findOneAndUpdate(
    { office: officeId, month, year },
    { locked: false },
    { new: true }
  );
  if (!lock) throw new ApiError(404, 'Not Found!', 'Salary lock record not found for this month.');

  return lock;
};

let calculationStatus = {};

export const autoCalculateAllSalary = async (officeId, month, year, adminId) => {
  const key = `${officeId}-${month}-${year}`;
  if (calculationStatus[key]) {
    throw new Error('Calculation is already in progress.');
  }
  calculationStatus[key] = true;

  try {
    logger.info('Auto calculating salary...', { officeId, month, year });
    const result = await autoCalculateAllSalaryByMonth(officeId, month, year);
    logger.info('Salary calculated successfully.', { officeId, month, year });
    return result;
  } catch (error) {
    logger.error('Error while auto calculating salary:', error);
    throw error;
  } finally {
    delete calculationStatus[key];
  }
};

const calculatePTax = (grossSalary) => {
  if (grossSalary < 10000) return 0;
  if (grossSalary < 15001) return 110;
  if (grossSalary < 25001) return 130;
  if (grossSalary < 40001) return 150;
  return 200;
};

const FIXED_PAYABLE_DAYS = 30;

const resolvePayableDays = (salaryStructure, month, year) => {
  if (salaryStructure.payableDays?.mode === 'monthly') {
    return getDaysInMonth(new Date(year, month - 1));
  }
  return FIXED_PAYABLE_DAYS;
};

const autoCalculateAllSalaryByMonth = async (officeId, month, year) => {
  try {
    const alreadyCalculated = await SalaryCalculation.findOne({
      office: officeId,
      month,
      year,
      locked: true,
    });

    if (alreadyCalculated) {
      throw new ApiError(400, 'Bad Request', `Salary for ${month}/${year} is frozen. Recalculation is not allowed.`);
    }

    const salaryStructure = await SalaryStructure.findOne({ office: officeId });
    if (!salaryStructure) throw new Error('Salary configuration not found.');
    const { startDate: monthStartDate, endDate: monthEndDate } = getMonthBoundariesFormatted(month, year);

    const [staffList, dutyTiming] = await Promise.all([
      Staff.find({ office: officeId }).lean(),
      DutyTiming.findOne({ office: officeId }),
    ]);
    if (!staffList.length) throw new Error('No staff found for the given office.');

    const daysInMonth = resolvePayableDays(salaryStructure, month, year);
    const isFixedPayableDays = salaryStructure.payableDays?.mode !== 'monthly';

    const actualDaysInMonth = getDaysInMonth(new Date(year, month - 1));

    const dailyWorkHours = parseInt(dutyTiming.endTime.split(':')[0]) - parseInt(dutyTiming.startTime.split(':')[0]);

    const halfDayAllowed =
      Number.isFinite(dutyTiming.halfDayAllowed) && dutyTiming.halfDayAllowed >= 0 ? dutyTiming.halfDayAllowed : 2;

    const splitHalfDayToConveyance = Boolean(
      salaryStructure.conveyance?.enabled && salaryStructure.conveyance?.mode === 'input'
    );

    const toDateKey = (date) => new Date(date).toISOString().slice(0, 10);
    const isUnadjustedAbsent = (record) => record?.status === 'absent' && record?.hrAdjustments?.adjustments === 'None';

    const results = await Promise.all(
      staffList.map(async (staff) => {
        if (!staff.monthlySalary || staff.monthlySalary <= 0) {
          logger.info(
            `Skipping salary calculation for ${staff.fullName} (${staff._id}) - Monthly salary not configured.`
          );
          return {
            staffId: staff._id,
            staffName: staff.fullName,
            message: 'Monthly salary not configured. Salary calculation skipped.',
          };
        }

        const overtimeRate = staff.overtimeRate || 0;
        const attendanceData = await Attendance.find({
          staffId: staff._id,
          date: { $gte: monthStartDate, $lte: monthEndDate },
        });

        const sortedAttendance = [...attendanceData].sort((a, b) => new Date(a.date) - new Date(b.date));
        const attendanceByDate = new Map(sortedAttendance.map((a) => [toDateKey(a.date), a]));

        let totalFullDays = 0,
          totalHalfDays = 0,
          totalHourPay = 0,
          overtimeHours = 0,
          totalPaidLeaves = 0,
          totalUnpaidLeaves = 0,
          totalHourlyDays = 0,
          totalWeekOffDays = 0,
          totalUnpaidWeekOffDays = 0,
          totalOffDayWorkDays = 0;

        sortedAttendance.forEach((attendance) => {
          if (attendance.hrAdjustments.adjustments !== 'None') {
            switch (attendance.hrAdjustments.adjustments) {
              case 'Half-day to Full-day':
                totalFullDays++;
                break;
              case 'Present to Half-day':
                totalHalfDays++;
                break;
              case 'Hourly':
                totalHourlyDays++;
                totalHourPay += attendance.totalWorkTime;
                break;
              case 'Present to Full-day':
                totalFullDays++;
                break;
              case 'Absent to Half-day':
                totalHalfDays++;
                break;
              case 'Absent to Full-day':
                totalFullDays++;
                break;
              case 'Present to Absent':
              case 'Half-day to Absent':
              case 'Full-day to Absent':
                attendance.leaveStatus === 'paid' ? totalPaidLeaves++ : totalUnpaidLeaves++;
                break;
            }
          } else if ((attendance.status === 'present' || attendance.status === 'half-day') && attendance.isOffDayWork) {
            totalOffDayWorkDays++;
          } else if (attendance.status === 'full-day') {
            totalFullDays++;
          } else if (attendance.status === 'half-day') {
            totalHalfDays++;
          } else if (attendance.status === 'week-off' || attendance.status === 'holiday') {
            const prevDate = new Date(attendance.date);
            prevDate.setDate(prevDate.getDate() - 1);
            const nextDate = new Date(attendance.date);
            nextDate.setDate(nextDate.getDate() + 1);

            const prevDayAttendance = attendanceByDate.get(toDateKey(prevDate));
            const nextDayAttendance = attendanceByDate.get(toDateKey(nextDate));

            const isSandwiched = isUnadjustedAbsent(prevDayAttendance) || isUnadjustedAbsent(nextDayAttendance);

            if (isSandwiched) {
              totalUnpaidWeekOffDays++;
            } else {
              totalWeekOffDays++;
            }
          } else if (attendance.status === 'absent' || attendance.status === 'present') {
            attendance.leaveStatus === 'paid' ? totalPaidLeaves++ : totalUnpaidLeaves++;
          }
        });

        const holidayLeaves = await Leave.find({
          staff: staff._id,
          office: officeId,
          dateFrom: { $gte: monthStartDate, $lte: monthEndDate },
          type: 'holidayLeave',
        }).lean();

        let holidayLeavesCount = 0;
        holidayLeaves.forEach((leave) => {
          leave.isPaid ? (totalPaidLeaves += leave.noOfDays) : (holidayLeavesCount += leave.noOfDays);
        });

        if (!totalFullDays && !totalHalfDays && !totalHourPay && !totalWeekOffDays && !totalOffDayWorkDays) {
          return { staffId: staff._id, message: 'No attendance recorded. Skipping salary calculation.' };
        }

        const forgivenHalfDays = Math.min(halfDayAllowed, totalHalfDays);
        const extraHalfDays = totalHalfDays - forgivenHalfDays;
        const unpaidHalfDays = extraHalfDays * 0.5;

        const totalUnpaidDays = totalUnpaidLeaves + holidayLeavesCount + unpaidHalfDays + totalUnpaidWeekOffDays;

        const uncappedWorkedDays =
          totalFullDays +
          forgivenHalfDays +
          extraHalfDays * 0.5 +
          totalPaidLeaves +
          totalWeekOffDays +
          totalOffDayWorkDays;

        const rawWorkedDays = isFixedPayableDays ? Math.min(uncappedWorkedDays, actualDaysInMonth) : uncappedWorkedDays;

        const workedDays = splitHalfDayToConveyance ? Math.floor(rawWorkedDays + 1e-9) : rawWorkedDays;
        const fractionDays = splitHalfDayToConveyance ? Math.max(0, rawWorkedDays - workedDays) : 0;

        const paidDays = workedDays;

        const dailyRate = staff.monthlySalary / daysInMonth;
        const hourlyPay = totalHourPay * (dailyRate / dailyWorkHours);
        const overtimePay = overtimeHours * overtimeRate;
        const bonus = 0;

        const baseSalary = staff.monthlySalary;

        let grossSalary;
        let leaveDeduction = 0;

        if (salaryStructure.grossSalary.calculationType === 'perDay') {
          grossSalary = Math.round(
            dailyRate * rawWorkedDays - totalHourlyDays * dailyRate + hourlyPay + overtimePay + bonus
          );
        } else {
          grossSalary = Math.round(baseSalary - totalHourlyDays * dailyRate + hourlyPay + overtimePay + bonus);
          leaveDeduction = Math.min(dailyRate * totalUnpaidDays, baseSalary);
        }

        const halfDayConveyance =
          fractionDays > 0 ? Math.min(Math.round(fractionDays * dailyRate), Math.max(grossSalary, 0)) : 0;
        const grossBase = grossSalary - halfDayConveyance;

        // ROUND OFF: basic
        let basic;
        if (salaryStructure.basicSalary.calculationType === 'onTotalSalary') {
          const basicDailyRate = ((salaryStructure.basicSalary.percentage / 100) * baseSalary) / daysInMonth;
          basic = Math.round(basicDailyRate * paidDays);
        } else {
          basic = Math.round((salaryStructure.basicSalary.percentage / 100) * grossBase);
        }

        const da = salaryStructure.da.enabled ? (salaryStructure.da.percentage / 100) * basic : 0;
        const otherAllowance = salaryStructure.otherAllowance.enabled
          ? (salaryStructure.otherAllowance.percentage / 100) * basic
          : 0;

        // ROUND OFF: hra
        let hra = 0;
        if (salaryStructure.hra.enabled) {
          const hraBase =
            salaryStructure.hra.calculateOn === 'gross'
              ? grossBase
              : salaryStructure.hra.calculateOn === 'basicPlusDa'
                ? basic + da
                : basic;
          hra = Math.round((salaryStructure.hra.percentage / 100) * hraBase);
        }

        let conveyance = 0;
        if (salaryStructure.conveyance.enabled) {
          if (salaryStructure.conveyance.mode === 'readonly') {
            conveyance = (salaryStructure.conveyance.percentage / 100) * grossBase;
          } else {
            conveyance = halfDayConveyance;
          }
        }

        const specialAllowance = salaryStructure.specialAllowance.enabled
          ? Math.max(0, grossBase - basic - da - hra)
          : 0;

        // ROUND OFF: pf
        let pfDeduction = 0;
        if (salaryStructure.pf.enabled && staff.pfNo) {
          const pfBase = salaryStructure.pf.calculateOn === 'basicPlusDa' ? basic + da : basic;
          const pfWage = Math.min(pfBase, salaryStructure.pf.wageCeiling);
          pfDeduction = Math.round((salaryStructure.pf.rate / 100) * pfWage);
        }

        // ROUND OFF: esi (eligibility = baseSalary <= wageCeiling, amount grossBase theke)
        let esiDeduction = 0;
        if (salaryStructure.esi.enabled && baseSalary <= salaryStructure.esi.wageCeiling) {
          esiDeduction = Math.round((salaryStructure.esi.rate / 100) * grossBase);
        }

        const pTax = salaryStructure.pTax.enabled ? calculatePTax(grossSalary) : 0;

        let lwfDeduction = 0;
        if (salaryStructure.lwf.enabled) {
          let lwfBase;
          switch (salaryStructure.lwf.calculateOn) {
            case 'basic':
              lwfBase = basic;
              break;
            case 'basicPlusDa':
              lwfBase = basic + da;
              break;
            case 'actualSalary':
              lwfBase = baseSalary;
              break;
            case 'gross':
            default:
              lwfBase = grossSalary;
              break;
          }
          if (lwfBase <= salaryStructure.lwf.wageCeiling) {
            lwfDeduction = salaryStructure.lwf.fixedAmount;
          }
        }

        let totalDeductions = Math.round(esiDeduction + pfDeduction + pTax + lwfDeduction + leaveDeduction);
        totalDeductions = Math.min(totalDeductions, grossSalary);
        let netSalary = Math.round(grossSalary - totalDeductions);

        const monthlyAdvanceDue = staff.advanceSalary?.monthlyDeduction ?? 0;
        let advanceDeduction = await deductAdvanceSalary(staff._id, month, year, netSalary >= monthlyAdvanceDue);
        if (advanceDeduction > 0) {
          totalDeductions += advanceDeduction;
          netSalary = Math.round(grossSalary - totalDeductions);
        }

        const unpaidHolidayLeaveDeduction = Math.min(holidayLeavesCount * dailyRate, grossSalary);

        const setFields = {
          baseSalary,
          totalPayableDays: daysInMonth,
          paidDays,
          workedDays,
          attendanceDetails: { totalFullDays, totalHalfDays, totalHourPay, overtimeHours },
          leaves: {
            totalPaidLeaves,
            totalUnpaidLeaves,
            totalHolidayLeaves: holidayLeavesCount,
            leaveDeduction: Math.round(leaveDeduction),
          },
          'breakdown.basic': basic,
          deductions: totalDeductions,
          grossSalary,
          netSalary,
        };
        const unsetFields = {};

        if (salaryStructure.da.enabled) setFields['breakdown.da'] = da;
        else unsetFields['breakdown.da'] = '';

        if (salaryStructure.otherAllowance.enabled) setFields['breakdown.otherAllowance'] = otherAllowance;
        else unsetFields['breakdown.otherAllowance'] = '';

        if (salaryStructure.hra.enabled) setFields['breakdown.hra'] = hra;
        else unsetFields['breakdown.hra'] = '';

        if (salaryStructure.conveyance.enabled) setFields['breakdown.conveyance'] = conveyance;
        else unsetFields['breakdown.conveyance'] = '';

        if (salaryStructure.specialAllowance.enabled) setFields['breakdown.specialAllowance'] = specialAllowance;
        else unsetFields['breakdown.specialAllowance'] = '';

        if (salaryStructure.esi.enabled && baseSalary <= salaryStructure.esi.wageCeiling) {
          setFields['breakdown.esi'] = esiDeduction;
        } else {
          unsetFields['breakdown.esi'] = '';
        }

        if (salaryStructure.pf.enabled && staff.pfNo) setFields['breakdown.pf'] = pfDeduction;
        else unsetFields['breakdown.pf'] = '';

        if (salaryStructure.pTax.enabled) setFields['breakdown.pTax'] = pTax;
        else unsetFields['breakdown.pTax'] = '';

        if (salaryStructure.lwf.enabled) setFields['breakdown.lwf'] = lwfDeduction;
        else unsetFields['breakdown.lwf'] = '';

        if (totalHourlyDays > 0) setFields['breakdown.hourlyPay'] = hourlyPay;
        else unsetFields['breakdown.hourlyPay'] = '';

        unsetFields['breakdown.bonus'] = '';

        if (advanceDeduction > 0) setFields['breakdown.advanceDeduction'] = advanceDeduction;
        else unsetFields['breakdown.advanceDeduction'] = '';

        await Salary.updateOne(
          { office: officeId, staff: staff._id, month, year },
          { $set: setFields, $unset: unsetFields },
          { upsert: true }
        );

        if (unpaidHolidayLeaveDeduction > 0) {
          creditHolidayLeavesFund(officeId, month, year, staff._id, unpaidHolidayLeaveDeduction);
        }

        return { staffId: staff._id, netSalary, message: 'Salary calculated successfully.' };
      })
    );
    return results;
  } catch (error) {
    logger.error('Error while auto calculating salary:', error);
    if (error instanceof ApiError) {
      throw error;
    }
    throw new Error(error.message || 'Failed to calculate salary.');
  }
};
/*
const autoCalculateAllSalaryByMonth = async (officeId, month, year) => {
  try {
    const salaryStructure = await SalaryStructure.findOne({ office: officeId });
    if (!salaryStructure) throw new Error('Salary configuration not found.');
    const { startDate: monthStartDate, endDate: monthEndDate } = getMonthBoundariesFormatted(month, year);

    const [weekOffs, holidays, staffList, dutyTiming] = await Promise.all([
      WeekOff.countDocuments({
        office: officeId,
        date: { $gte: monthStartDate, $lte: monthEndDate },
      }),
      Holiday.countDocuments({
        office: officeId,
        date: { $gte: monthStartDate, $lte: monthEndDate },
      }),
      Staff.find({ office: officeId }).lean(),
      DutyTiming.findOne({ office: officeId }),
    ]);

    const daysInMonth = differenceInCalendarDays(new Date(monthEndDate), new Date(monthStartDate)) + 1;
    const totalWorkingDays = daysInMonth - weekOffs - holidays;
    if (totalWorkingDays <= 0) throw new Error('No working days in this month.');
    if (!staffList.length) throw new Error('No staff found for the given office.');

    const lateAllowed = dutyTiming.lateAllowed; //TODO: late allowed count
    const dailyWorkHours = dutyTiming.endTime.split(':')[0] - dutyTiming.startTime.split(':')[0]; //REVIEW:

    //Main Calculation
    const results = await Promise.all(
      staffList.map(async (staff) => {
        const attendanceData = await Attendance.find({
          staffId: staff._id,
          date: { $gte: monthStartDate, $lte: monthEndDate },
        });

        let totalFullDays = 0,
          totalHalfDays = 0,
          totalHourPay = 0,
          overtimeHours = 0,
          totalPaidLeaves = 0,
          totalUnpaidLeaves = 0;

        // Process HR adjustments first
        attendanceData.forEach((attendance) => {
          if (attendance.hrAdjustments.adjustments !== 'None') {
            switch (attendance.hrAdjustments.adjustments) {
              case 'Half-day to Full-day':
                totalFullDays++;
                break;
              case 'Present to Half-day':
                totalHalfDays++;
                break;
              case 'Hourly':
                totalHourPay += attendance.totalWorkTime;
                break;
            }
          } else if (attendance.status === 'full-day') {
            totalFullDays++;
          } else if (attendance.status === 'half-day') {
            totalHalfDays++;
          } else if (attendance.status === 'absent') {
            attendance.leaveStatus === 'paid' ? totalPaidLeaves++ : totalUnpaidLeaves++;
          }
        });

        // Fetch all holidayLeaves for the staff in the given month
        const holidayLeaves = await Leave.find({
          staff: staff._id,
          office: officeId,
          dateFrom: { $gte: monthStartDate, $lte: monthEndDate },
          type: 'holidayLeave',
        }).lean();

        let holidayLeavesCount = 0;
        holidayLeaves.forEach((leave) => {
          leave.isPaid ? (totalPaidLeaves += leave.noOfDays) : (holidayLeavesCount += leave.noOfDays);
        });

        if (!totalFullDays && !totalHalfDays && !totalHourPay) {
          return { staffId: staff._id, message: 'No attendance recorded. Skipping salary calculation.' };
        }

        // Calculate Salary Breakdown
        const allowedHalfDays = Math.min(dutyTiming.halfDayAllowed, totalHalfDays);
        const totalDaysWorked =
          totalFullDays + allowedHalfDays + totalPaidLeaves + (totalHalfDays - allowedHalfDays) * 0.5;
        const dailyRate = staff.monthlySalary / totalWorkingDays;
        const hourlyPay = totalHourPay * (dailyRate / dailyWorkHours);
        const baseSalary = dailyRate * totalDaysWorked + hourlyPay;

        const basic = (salaryStructure.basic_percentage / 100) * baseSalary;
        const hra = (salaryStructure.hra_allowance_percentage / 100) * baseSalary;
        const conveyance = (salaryStructure.conveyance_allowance_percentage / 100) * baseSalary;
        const specialAllowance = (salaryStructure.special_allowance_percentage / 100) * baseSalary;
        const otherAllowance = (salaryStructure.other_allowance_percentage / 100) * baseSalary;
        const overtimePay = overtimeHours * staff.overtimeRate;
        const bonus = 0; //TODO:

        let grossSalary = Math.round(baseSalary + bonus + overtimePay);
        const unpaidHolidayLeaveDeduction = Math.min(holidayLeavesCount * dailyRate, grossSalary);

        let pfDeduction = staff.pfNo && basic > 15000 ? (salaryStructure.pf_rate / 100) * basic : 0;
        let esiDeduction = staff.esiNo && grossSalary < 21000 ? (salaryStructure.esi_rate / 100) * grossSalary : 0;
        const pTax = getPtax(grossSalary);

        let totalDeductions = Math.round(esiDeduction + pfDeduction + pTax + unpaidHolidayLeaveDeduction);
        if (totalDeductions > grossSalary) {
          totalDeductions = grossSalary;
        }
        const netSalaryWithAdvance = Math.round(grossSalary - totalDeductions);

        // Deduct Advance
        let advanceDeduction = 0;
        if (netSalaryWithAdvance >= staff.advanceSalary?.monthlyDeduction) {
          // Deduct Advance if salary is greater than monthly deduction
          advanceDeduction = await deductAdvanceSalary(staff._id, month, year);
          totalDeductions += advanceDeduction;
        }
        const netSalary = Math.round(grossSalary - totalDeductions);

        // Save Salary Data
        await Salary.updateOne(
          { office: officeId, staff: staff._id, month, year },
          {
            baseSalary: staff.monthlySalary,
            totalWorkingDays,
            attendanceDetails: { totalFullDays, totalHalfDays, totalHourPay, overtimeHours },
            leaves: {
              totalPaidLeaves,
              totalUnpaidLeaves,
              totalHolidayLeaves: holidayLeavesCount,
              leaveDeduction: Math.round(unpaidHolidayLeaveDeduction),
            },
            breakdown: {
              basic,
              hra,
              conveyance,
              specialAllowance,
              otherAllowance,
              esi: esiDeduction,
              pf: pfDeduction,
              pTax,
              hourlyPay,
              bonus,
              overtime: overtimePay,
              advanceDeduction,
            },
            deductions: totalDeductions,
            grossSalary,
            netSalary,
          },
          { upsert: true, new: true }
        );

        if (unpaidHolidayLeaveDeduction > 0) {
          creditHolidayLeavesFund(officeId, month, year, staff._id, unpaidHolidayLeaveDeduction);
        }

        return { staffId: staff._id, netSalary, message: 'Salary calculated successfully.' };
      })
    );
    return results;
  } catch (error) {
    logger.error('Error while auto calculating salary:', error);
    throw new Error(error);
  }
};
*/

export const saveAdvanceSalary = async ({
  staffId,
  totalAmount,
  remainingAmount,
  remainingMonths,
  dateTaken,
  startMonth,
  startYear,
  remarks,
  pausedMonths = [],
  pauseMonth = undefined,
  removePauseMonth = undefined,
  action = 'update',
}) => {
  const staff = await Staff.findById(staffId);
  if (!staff) {
    throw new ApiError(404, 'Not Found!', 'Staff not found');
  }

  const lockMonth =
    startMonth ||
    (pauseMonth ? Number(pauseMonth.split('-')[1]) : null) ||
    (removePauseMonth ? Number(removePauseMonth.split('-')[1]) : null);
  const lockYear =
    startYear ||
    (pauseMonth ? Number(pauseMonth.split('-')[0]) : null) ||
    (removePauseMonth ? Number(removePauseMonth.split('-')[0]) : null);
  if (lockMonth && lockYear) {
    await assertSalaryNotLocked(staff.office, Number(lockMonth), Number(lockYear));
  }

  // Pause/un-pause korar month frozen hole block hobe
  for (const pm of [pauseMonth, removePauseMonth].filter(Boolean)) {
    const [py, pmth] = pm.split('-').map(Number);
    await assertSalaryNotLocked(staff.office, pmth, py);
  }

  if (action === 'add') {
    if (staff.advanceSalary && staff.advanceSalary.remainingAmount > 0) {
      throw new ApiError(400, 'Unpaid advance found!', [
        { message: 'Staff already has a pending advance. Please clear it first.' },
      ]);
    }
    if (!startMonth || !startYear) {
      throw new ApiError(400, 'Bad Request', 'startMonth and startYear are required.');
    }

    const monthlyDeduction = Math.ceil(remainingAmount / (remainingMonths || 1));

    const initialPausedMonths = Array.isArray(pausedMonths)
      ? pausedMonths.filter(Boolean).map((p) => {
          const [y, m] = p.split('-').map(Number);
          return { year: y, month: m };
        })
      : [];

    staff.advanceSalary = {
      totalAmount,
      remainingAmount,
      remainingMonths,
      monthlyDeduction,
      dateTaken: dateTaken ? new Date(dateTaken) : new Date(),
      startMonth: Number(startMonth),
      startYear: Number(startYear),
      pausedMonths: initialPausedMonths,
      remarks,
    };

    await staff.save();

    await AdvanceTransaction.create({
      office: staff.office,
      staff: staffId,
      type: 'add',
      amount: totalAmount,
      newMonths: remainingMonths,
      dateTaken: staff.advanceSalary.dateTaken,
      startMonth: staff.advanceSalary.startMonth,
      startYear: staff.advanceSalary.startYear,
      month: staff.advanceSalary.startMonth,
      year: staff.advanceSalary.startYear,
      remarks:
        initialPausedMonths.length > 0
          ? `${remarks || ''} (Pre-paused: ${initialPausedMonths.map((p) => `${p.month}/${p.year}`).join(', ')})`.trim()
          : remarks,
    });

    return staff.advanceSalary;
  }

  if (action === 'update') {
    if (!staff.advanceSalary) {
      throw new ApiError(400, 'No advance found!', [{ message: 'Staff does not have an advance.' }]);
    }

    const oldRemaining = staff.advanceSalary.remainingAmount;
    const oldMonths = staff.advanceSalary.remainingMonths;

    const hasAmountChange = remainingAmount !== undefined && remainingMonths !== undefined;

    if (hasAmountChange) {
      const updatedRemaining = Math.max(0, Number(remainingAmount));
      const updatedMonths = Math.max(0, Number(remainingMonths));

      if (updatedRemaining === 0 && updatedMonths === 0) {
        staff.advanceSalary = undefined;
      } else {
        staff.advanceSalary.remainingAmount = updatedRemaining;
        staff.advanceSalary.remainingMonths = updatedMonths;
        staff.advanceSalary.monthlyDeduction = updatedMonths > 0 ? Math.ceil(updatedRemaining / updatedMonths) : 0;
      }
    }

    let reversedOnPause = 0;
    let reversedMonth = null;
    let reversedYear = null;

    if (staff.advanceSalary) {
      if (remarks !== undefined) staff.advanceSalary.remarks = remarks;

      if (startMonth && startYear) {
        staff.advanceSalary.startMonth = Number(startMonth);
        staff.advanceSalary.startYear = Number(startYear);
      }

      if (!staff.advanceSalary.pausedMonths) staff.advanceSalary.pausedMonths = [];

      if (pauseMonth) {
        const [pYear, pMonth] = pauseMonth.split('-').map(Number);
        const alreadyPaused = staff.advanceSalary.pausedMonths.some((p) => p.month === pMonth && p.year === pYear);
        if (!alreadyPaused) {
          staff.advanceSalary.pausedMonths.push({ month: pMonth, year: pYear });
        }

        // Ei month e jodi age-i deduction hoye giye thake, seta reverse koro
        reversedOnPause = await reverseAdvanceDeductionForMonth(staff, pMonth, pYear);
        reversedMonth = pMonth;
        reversedYear = pYear;
      }

      if (removePauseMonth) {
        const [rYear, rMonth] = removePauseMonth.split('-').map(Number);
        staff.advanceSalary.pausedMonths = staff.advanceSalary.pausedMonths.filter(
          (p) => !(p.month === rMonth && p.year === rYear)
        );
      }
    }

    await staff.save();

    // Already calculated payslip thakle, ar advance deduction bad dao
    if (reversedOnPause > 0) {
      await removeAdvanceFromPayslip(staff.office, staffId, reversedMonth, reversedYear, reversedOnPause);
    }

    const finalRemaining = staff.advanceSalary?.remainingAmount ?? (hasAmountChange ? 0 : oldRemaining);
    const finalMonths = staff.advanceSalary?.remainingMonths ?? (hasAmountChange ? 0 : oldMonths);

    await AdvanceTransaction.create({
      office: staff.office,
      staff: staffId,
      type: 'update',
      amount: hasAmountChange ? Math.abs(Number(remainingAmount) - oldRemaining) : reversedOnPause,
      remarks:
        remarks ||
        (pauseMonth
          ? `Paused deduction for ${pauseMonth}${reversedOnPause > 0 ? ` (${reversedOnPause} deduction reversed)` : ''}`
          : removePauseMonth
            ? `Un-paused deduction for ${removePauseMonth}`
            : ''),
      previousAmount: oldRemaining,
      newAmount: hasAmountChange ? Math.max(0, Number(remainingAmount)) : finalRemaining,
      previousMonths: oldMonths,
      newMonths: hasAmountChange ? Math.max(0, Number(remainingMonths)) : finalMonths,
    });

    return staff.advanceSalary;
  }

  throw new ApiError(400, 'Bad Request', `Unsupported action type: ${action}`);
};
/*
export const saveAdvanceSalary = async (staffId, totalAmount, remainingAmount, remainingMonths, remarks = '') => {
  try {
    const staff = await Staff.findById(staffId);
    if (!staff) {
      throw new Error('Staff not found');
    }
    // Calculate monthly deduction
    const monthlyDeduction = Math.ceil(remainingAmount / remainingMonths);
    // Set or update advance salary
    staff.advanceSalary = {
      totalAmount,
      remainingAmount,
      remainingMonths,
      monthlyDeduction,
      remarks,
    };
    await staff.save();
    try {
      AdvanceTransaction.create({
        office: staff.office,
        staff: staffId,
        type: 'add',
        amount: totalAmount,
        remarks,
      });
    } catch (error) {
      logger.error('Error while saving advance transaction:', error);
    }
    return staff.advanceSalary;
  } catch (error) {
    throw error;
  }
};
*/
// Deduct advance salary
// Deduct advance salary
async function deductAdvanceSalary(staffId, month = null, year = null, allowNewDeduction = true) {
  const staff = await Staff.findById(staffId);
  if (!staff) return 0;

  const adv = staff.advanceSalary;

  // ---- PAUSED MONTH: sobar age check. Kono deduction hobe na, age hoye thakle reverse hobe ----
  const isPausedThisMonth = !!adv && (adv.pausedMonths || []).some((p) => p.month === month && p.year === year);

  if (isPausedThisMonth) {
    const reversed = await reverseAdvanceDeductionForMonth(staff, month, year);
    if (reversed > 0) {
      await staff.save();
    }

    const alreadyLogged = await AdvanceTransaction.findOne({
      staff: staffId,
      type: 'update',
      month,
      year,
      remarks: 'Paused - deduction skipped for this month',
    });
    if (!alreadyLogged) {
      try {
        await AdvanceTransaction.create({
          office: staff.office,
          staff: staffId,
          month,
          year,
          type: 'update',
          amount: 0,
          remarks: 'Paused - deduction skipped for this month',
        });
      } catch (error) {
        logger.error('Error while logging paused advance month:', error);
      }
    }

    // Reverse korar por je deduction (onno/purono advance er) baki ache shetai return hobe
    const leftover = await AdvanceTransaction.find({
      staff: staffId,
      type: 'deduct',
      month,
      year,
    }).lean();
    return sumAmount(leftover);
  }

  // Ei month e ager joto deduction hoyeche (ekta month e ekadhik advance-er deduction thakte pare)
  const existingDeductions = await AdvanceTransaction.find({
    staff: staffId,
    type: 'deduct',
    month,
    year,
  }).lean();
  const alreadyDeducted = sumAmount(existingDeductions);

  if (!allowNewDeduction || !adv || !adv.remainingAmount || adv.remainingMonths <= 0) {
    return alreadyDeducted;
  }

  const currentPeriod = year * 12 + (month - 1);

  if (adv.startYear && adv.startMonth) {
    const startPeriod = adv.startYear * 12 + (adv.startMonth - 1);
    if (currentPeriod < startPeriod) return alreadyDeducted;
  }

  // Current advance er deduction ei month e ager-i hoyeche kina?
  // Latest 'add' er por je deduction hoyeche shetai current advance er.
  const latestAdd = await AdvanceTransaction.findOne({ staff: staffId, type: 'add' }).sort({ createdAt: -1 }).lean();

  const currentAdvanceAlreadyDeducted = existingDeductions.some(
    (t) => !latestAdd || new Date(t.createdAt) >= new Date(latestAdd.createdAt)
  );
  if (currentAdvanceAlreadyDeducted) {
    return alreadyDeducted;
  }

  const deduction = Math.min(adv.monthlyDeduction, adv.remainingAmount);

  adv.remainingAmount -= deduction;
  adv.remainingMonths -= 1;

  if (adv.remainingMonths <= 0 || adv.remainingAmount <= 0) {
    staff.advanceSalary = undefined;
  }

  await staff.save();

  try {
    await AdvanceTransaction.create({
      office: staff.office,
      staff: staffId,
      month,
      year,
      type: 'deduct',
      amount: deduction,
      remarks: 'Auto Deduction',
    });
  } catch (error) {
    logger.error('Error while saving advance transaction:', error);
  }

  return alreadyDeducted + deduction;
}

function getPtax(salary) {
  const ptaxSlabs = [
    { min: 0, max: 10000, tax: 0 },
    { min: 10001, max: 15000, tax: 110 },
    { min: 15001, max: 25000, tax: 130 },
    { min: 25001, max: 40000, tax: 150 },
    { min: 40001, max: Infinity, tax: 200 },
  ];

  const tax = ptaxSlabs.find((slab) => salary >= slab.min && salary <= slab.max);
  return tax ? tax.tax : 0;
}

export const generateSalaryPdf = async (officeId, staffId, month, year) => {
  const [salary, salaryStructure] = await Promise.all([
    Salary.findOne({ office: officeId, staff: staffId, month, year })
      .populate('office', 'name')
      .populate('staff', 'fullName pfNo esiNo')
      .lean(),
    SalaryStructure.findOne({ office: officeId }).lean(),
  ]);

  if (!salary) {
    throw new ApiError(404, 'Not Found!', 'Salary not found for the given staff and month.');
  }
  if (!salaryStructure) {
    throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  }

  const doc = new jsPDF({ format: 'a4', orientation: 'l' });
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();

  doc.setFont('times', 'bold');
  doc.setFontSize(14);
  doc.setLineWidth(0.5);
  doc.text(
    `PAY DETAILS FOR THE MONTH OF ${format(new Date(salary.year, salary.month - 1), 'MMMM').toUpperCase()} - ${salary.year}`,
    pageWidth / 2,
    10,
    { align: 'center' }
  );
  doc.setLineWidth(0.1);
  doc.line(pageWidth * 0.3, 11, pageWidth * 0.7, 11);
  doc.setFontSize(10);
  doc.text(salary.office?.name, pageWidth / 2, 15, { align: 'center' });

  const columnDefs = [
    { header: 'Name', getValue: (s) => s.staff?.fullName || '-' },
    { header: 'Rate', getValue: (s) => Math.round(s.baseSalary / s.totalPayableDays) },
    { header: 'W/D', getValue: (s) => s.workedDays ?? 0 },
    { header: 'BASIC', getValue: (s) => safeRound(s.breakdown?.basic) },
  ];

  if (salaryStructure.da?.enabled) {
    columnDefs.push({ header: 'DA', getValue: (s) => safeToFixed(s.breakdown?.da) });
  }
  if (salaryStructure.hra?.enabled) {
    columnDefs.push({ header: 'HRA', getValue: (s) => safeRound(s.breakdown?.hra) });
  }
  if (salaryStructure.specialAllowance?.enabled) {
    columnDefs.push({ header: 'SPL ALLOW', getValue: (s) => safeToFixed(s.breakdown?.specialAllowance) });
  }
  if (salaryStructure.otherAllowance?.enabled) {
    columnDefs.push({ header: 'Other Allowance', getValue: (s) => safeToFixed(s.breakdown?.otherAllowance) });
  }

  columnDefs.push({
    header: 'Gross Wages',
    getValue: (s) => safeRound(getGrossWages(s)),
  });

  if (salaryStructure.conveyance?.enabled) {
    columnDefs.push({ header: 'CONV', getValue: (s) => safeToFixed(s.breakdown?.conveyance) });
  }

  columnDefs.push({ header: 'TOTAL GROSS', getValue: (s) => safeRound(s.grossSalary) });

  if (salaryStructure.pf?.enabled) {
    columnDefs.push({ header: 'PF', getValue: (s) => safeRound(s.breakdown?.pf) });
  }
  if (salaryStructure.esi?.enabled) {
    columnDefs.push({ header: 'ESI', getValue: (s) => safeRound(s.breakdown?.esi) });
  }
  if (salaryStructure.pTax?.enabled) {
    columnDefs.push({ header: 'P TAX', getValue: (s) => safeToFixed(s.breakdown?.pTax) });
  }
  if (salaryStructure.lwf?.enabled) {
    columnDefs.push({ header: 'LWF', getValue: (s) => safeToFixed(s.breakdown?.lwf) });
  }

  columnDefs.push({ header: 'ADV.', getValue: (s) => safeToFixed(s.breakdown?.advanceDeduction) });

  if (salaryStructure.overtime?.enabled) {
    columnDefs.push({ header: 'OT', getValue: (s) => safeToFixed(s.breakdown?.overtime) });
  }

  columnDefs.push({ header: 'TD', getValue: (s) => safeToFixed(s.deductions) });

  columnDefs.push({ header: 'Net Amt.', getValue: (s) => s.netSalary });

  const headers = [columnDefs.map((col) => col.header)];
  const rows = [columnDefs.map((col) => col.getValue(salary))];

  autoTable(doc, {
    startY: 20,
    head: headers,
    body: rows,
    theme: 'grid',
    didDrawPage: (data) => {
      doc.setFontSize(8);
      const officeUseText = `For ${salary.office?.name || ''}`;
      const officeTextWidth = doc.getTextWidth(officeUseText);
      doc.text(officeUseText, pageWidth - data.settings.margin.right - officeTextWidth, data.cursor.y + 15);

      doc.setLineWidth(0.2);
      doc.setLineDashPattern([2, 1]);
      doc.line(
        data.settings.margin.left,
        data.cursor.y + 25,
        pageWidth - data.settings.margin.right,
        data.cursor.y + 25
      );

      const pageCount = doc.internal.getNumberOfPages();
      const footerText = `Page ${pageCount}`;
      const generatedDate = `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;

      doc.setFontSize(10);
      doc.text(footerText, data.settings.margin.left, pageHeight - 10);

      const textWidth = doc.getTextWidth(generatedDate);
      doc.text(generatedDate, pageWidth - data.settings.margin.right - textWidth, pageHeight - 10);
    },
  });

  return doc.output('arraybuffer');
};

const safeToFixed = (value, decimals = 2) => {
  if (value === undefined || value === null || isNaN(value)) return (0).toFixed(decimals);
  return Number(value).toFixed(decimals);
};

// Whole-rupee display (no decimals)
const safeRound = (value) => {
  if (value === undefined || value === null || isNaN(value)) return '0';
  return String(Math.round(Number(value)));
};

// Numeric round (Excel / table er jonno)
const roundInt = (v) => Math.round(Number(v) || 0);

// Gross Wages = conveyance er age-er earnings
const getGrossWages = (s) =>
  (s.breakdown?.basic ?? 0) +
  (s.breakdown?.da ?? 0) +
  (s.breakdown?.hra ?? 0) +
  (s.breakdown?.otherAllowance ?? 0) +
  (s.breakdown?.specialAllowance ?? 0);

export const generateSalaryByMonth = async (officeId, month, year) => {
  const [salaries, salaryStructure] = await Promise.all([
    Salary.find({ office: officeId, month, year })
      .populate('office', 'name')
      .populate('staff', 'fullName pfNo esiNo')
      .lean(),
    SalaryStructure.findOne({ office: officeId }).lean(),
  ]);

  if (!salaries.length) {
    throw new ApiError(404, 'Not Found!', 'No salaries found for the given month.');
  }
  if (!salaryStructure) {
    throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  }

  const doc = new jsPDF({ format: 'a4', orientation: 'l' });
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();

  const columnDefs = [
    { header: 'Name', getValue: (s) => s.staff?.fullName || '-' },
    { header: 'Rate', getValue: (s) => s.baseSalary },
    { header: 'W/D', getValue: (s) => s.workedDays ?? 0 },
    { header: 'BASIC', getValue: (s) => safeRound(s.breakdown?.basic) },
  ];

  if (salaryStructure.da?.enabled) {
    columnDefs.push({ header: 'DA', getValue: (s) => safeToFixed(s.breakdown?.da) });
  }
  if (salaryStructure.hra?.enabled) {
    columnDefs.push({ header: 'HRA', getValue: (s) => safeRound(s.breakdown?.hra) });
  }
  if (salaryStructure.specialAllowance?.enabled) {
    columnDefs.push({ header: 'SPL ALLOW', getValue: (s) => safeToFixed(s.breakdown?.specialAllowance) });
  }
  if (salaryStructure.otherAllowance?.enabled) {
    columnDefs.push({ header: 'Other Allowance', getValue: (s) => safeToFixed(s.breakdown?.otherAllowance) });
  }

  columnDefs.push({
    header: 'Gross Wages',
    getValue: (s) => safeRound(getGrossWages(s)),
  });

  if (salaryStructure.conveyance?.enabled) {
    columnDefs.push({ header: 'CONV', getValue: (s) => safeToFixed(s.breakdown?.conveyance) });
  }

  columnDefs.push({ header: 'TOTAL GROSS', getValue: (s) => safeRound(s.grossSalary) });

  if (salaryStructure.pf?.enabled) {
    columnDefs.push({ header: 'PF', getValue: (s) => safeRound(s.breakdown?.pf) });
  }
  if (salaryStructure.esi?.enabled) {
    columnDefs.push({ header: 'ESI', getValue: (s) => safeRound(s.breakdown?.esi) });
  }
  if (salaryStructure.pTax?.enabled) {
    columnDefs.push({ header: 'P TAX', getValue: (s) => safeToFixed(s.breakdown?.pTax) });
  }
  if (salaryStructure.lwf?.enabled) {
    columnDefs.push({ header: 'LWF', getValue: (s) => safeToFixed(s.breakdown?.lwf) });
  }

  columnDefs.push({ header: 'ADV.', getValue: (s) => safeToFixed(s.breakdown?.advanceDeduction) });

  if (salaryStructure.overtime?.enabled) {
    columnDefs.push({ header: 'OT', getValue: (s) => safeToFixed(s.breakdown?.overtime) });
  }

  columnDefs.push({ header: 'TD', getValue: (s) => safeToFixed(s.deductions) });

  columnDefs.push({ header: 'Net Amt.', getValue: (s) => s.netSalary });

  const headers = [columnDefs.map((col) => col.header)];

  let rowIndex = 0;
  let startY = 20;
  let footerPrinted = false;

  for (const salary of salaries) {
    if (rowIndex > 0 && rowIndex % 3 === 0) {
      doc.addPage();
      startY = 20;
      footerPrinted = false;
    }
    doc.setFont('times', 'bold');
    doc.setFontSize(14);
    doc.setLineWidth(0.5);

    doc.text(
      `PAY DETAILS FOR THE MONTH OF ${format(new Date(salary.year, salary.month - 1), 'MMMM').toUpperCase()} - ${salary.year}`,
      pageWidth / 2,
      startY - 10,
      { align: 'center' }
    );
    doc.setLineWidth(0.1);
    doc.setLineDashPattern([0, 0]);
    doc.line(pageWidth * 0.3, startY - 9, pageWidth * 0.7, startY - 9);
    doc.setFontSize(10);
    doc.text(salary.office?.name, pageWidth / 2, startY - 5, { align: 'center' });

    const rows = [columnDefs.map((col) => col.getValue(salary))];

    autoTable(doc, {
      startY: startY,
      head: headers,
      body: rows,
      theme: 'grid',
      didDrawPage: (data) => {
        doc.setFontSize(8);
        const officeUseText = `For ${salary.office?.name || ''}`;
        const officeTextWidth = doc.getTextWidth(officeUseText);
        doc.text(officeUseText, pageWidth - data.settings.margin.right - officeTextWidth, data.cursor.y + 15);

        doc.setLineWidth(0.2);
        doc.setLineDashPattern([2, 1]);
        doc.line(
          data.settings.margin.left,
          data.cursor.y + 25,
          pageWidth - data.settings.margin.right,
          data.cursor.y + 25
        );

        if (!footerPrinted) {
          doc.setFontSize(10);
          doc.text(`Page ${doc.internal.getNumberOfPages()}`, data.settings.margin.left, pageHeight - 10);

          const generatedDate = `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
          const textWidth = doc.getTextWidth(generatedDate);
          doc.text(generatedDate, pageWidth - data.settings.margin.right - textWidth, pageHeight - 10);
          footerPrinted = true;
        }
      },
    });

    rowIndex++;
    startY = doc.lastAutoTable.finalY + 50;
  }

  return doc.output('arraybuffer');
};

const thinBorder = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export const generateSalaryExcelByMonth = async (officeId, month, year, filters = {}) => {
  const { departmentId, pfStatus } = filters;

  const staffMatch = { office: officeId };
  if (departmentId && departmentId !== 'all') staffMatch.department = departmentId;
  if (pfStatus === 'withPF') staffMatch.pfNo = { $exists: true, $nin: [null, ''] };
  else if (pfStatus === 'withoutPF') staffMatch.$or = [{ pfNo: { $exists: false } }, { pfNo: null }, { pfNo: '' }];

  const matchingStaff = await Staff.find(staffMatch).select('_id').lean();
  const staffIds = matchingStaff.map((s) => s._id);

  const [salaries, salaryStructure, office] = await Promise.all([
    Salary.find({ office: officeId, month, year, staff: { $in: staffIds } })
      .populate({
        path: 'staff',
        select: 'fullName pfNo esiNo department',
        populate: { path: 'department', select: 'name' },
      })
      .lean(),
    SalaryStructure.findOne({ office: officeId }).lean(),
    Office.findById(officeId).lean(),
  ]);

  if (!salaries.length) {
    throw new ApiError(404, 'Not Found!', 'No salaries found for the given filters.');
  }
  if (!salaryStructure) {
    throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  }

  const columnDefs = [
    { header: 'SL NO', key: 'slNo', width: 8 },
    { header: 'NAME', key: 'name', width: 22 },
    { header: 'DEPARTMENT', key: 'department', width: 16 },
    { header: 'RATE', key: 'rate', width: 10 },
    { header: 'NOD', key: 'nod', width: 8, sum: true },
    { header: 'BASIC', key: 'basic', width: 10, sum: true },
  ];

  if (salaryStructure.hra?.enabled) {
    columnDefs.push({ header: 'HRA', key: 'hra', width: 10, sum: true });
  }
  if (salaryStructure.specialAllowance?.enabled) {
    columnDefs.push({ header: 'SPL ALLOWANCE', key: 'splAllowance', width: 14, sum: true });
  }
  if (salaryStructure.otherAllowance?.enabled) {
    columnDefs.push({ header: 'OTHER ALLOW', key: 'otherAllowance', width: 12, sum: true });
  }

  columnDefs.push({ header: 'GROSS', key: 'gross', width: 10, sum: true });

  if (salaryStructure.conveyance?.enabled) {
    columnDefs.push({ header: 'CONV', key: 'conv', width: 9, sum: true });
  }

  columnDefs.push({ header: 'TOTAL GROSS', key: 'totalGross', width: 13, sum: true });

  if (salaryStructure.pf?.enabled) {
    columnDefs.push({ header: 'PF', key: 'pf', width: 9, sum: true });
  }
  if (salaryStructure.esi?.enabled) {
    columnDefs.push({ header: 'ESI', key: 'esi', width: 9, sum: true });
  }
  if (salaryStructure.pTax?.enabled) {
    columnDefs.push({ header: 'P TAX', key: 'pTax', width: 9, sum: true });
  }
  if (salaryStructure.lwf?.enabled) {
    columnDefs.push({ header: 'L.W.F', key: 'lwf', width: 9, sum: true });
  }

  columnDefs.push({ header: 'LESS ADVANCE', key: 'lessAdvance', width: 13, sum: true });
  columnDefs.push({ header: 'TD', key: 'td', width: 10, sum: true });
  columnDefs.push({ header: 'NET', key: 'net', width: 11, sum: true });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Salary Sheet');
  const colCount = columnDefs.length;

  columnDefs.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width;
  });

  sheet.mergeCells(1, 1, 1, colCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = office?.name?.toUpperCase() || 'COMPANY NAME';
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB39DDB' } };
  sheet.getRow(1).height = 20;

  sheet.mergeCells(2, 1, 2, colCount);
  const subtitleCell = sheet.getCell(2, 1);
  const monthLabel = format(new Date(year, month - 1), 'MMMM').toUpperCase();
  subtitleCell.value = `SALARY SHEET ${monthLabel}'${String(year).slice(-2)}`;
  subtitleCell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
  sheet.getRow(2).height = 16;

  const headerRow = sheet.getRow(3);
  columnDefs.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
    cell.border = thinBorder;
  });
  headerRow.height = 24;

  const firstDataRow = 4;
  let rowIndex = firstDataRow;

  salaries.forEach((s, i) => {
    const gross = getGrossWages(s);

    const rowData = {
      slNo: i + 1,
      name: s.staff?.fullName || '-',
      department: s.staff?.department?.name || '-',
      rate: s.baseSalary,
      nod: s.workedDays ?? 0,
      basic: roundInt(s.breakdown?.basic),
      hra: roundInt(s.breakdown?.hra),
      splAllowance: round2(s.breakdown?.specialAllowance),
      otherAllowance: round2(s.breakdown?.otherAllowance),
      gross: roundInt(gross),
      conv: round2(s.breakdown?.conveyance),
      totalGross: roundInt(s.grossSalary),
      pf: roundInt(s.breakdown?.pf),
      esi: roundInt(s.breakdown?.esi),
      pTax: round2(s.breakdown?.pTax),
      lwf: round2(s.breakdown?.lwf),
      lessAdvance: round2(s.breakdown?.advanceDeduction),
      td: round2(s.deductions),
      net: s.netSalary,
    };

    const row = sheet.getRow(rowIndex);
    columnDefs.forEach((col, idx) => {
      const cell = row.getCell(idx + 1);
      cell.value = rowData[col.key];
      cell.font = { size: 9 };
      cell.border = thinBorder;
      cell.alignment = { horizontal: ['name', 'department'].includes(col.key) ? 'left' : 'center' };
    });
    rowIndex++;
  });

  const lastDataRow = rowIndex - 1;

  const totalRow = sheet.getRow(rowIndex);
  sheet.mergeCells(rowIndex, 1, rowIndex, 3); // SL NO + NAME + DEPARTMENT merged now

  const totalLabelCell = totalRow.getCell(1);
  totalLabelCell.value = 'TOTAL';
  totalLabelCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  totalLabelCell.alignment = { horizontal: 'center', vertical: 'middle' };
  totalLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
  totalLabelCell.border = thinBorder;

  columnDefs.forEach((col, idx) => {
    if (idx < 3) return; // SL NO + NAME + DEPARTMENT already merged/labeled
    const cell = totalRow.getCell(idx + 1);
    const colLetter = sheet.getColumn(idx + 1).letter;

    if (col.sum) {
      cell.value = { formula: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})` };
    } else {
      cell.value = col.key === 'rate' ? '.' : '';
    }
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
    cell.border = thinBorder;
  });
  totalRow.height = 18;

  return workbook.xlsx.writeBuffer();
};

export const getSalaryTableByMonth = async (officeId, month, year, filters = {}) => {
  const { departmentId, pfStatus } = filters; // pfStatus: 'all' | 'withPF' | 'withoutPF'

  const staffMatch = { office: officeId };
  if (departmentId && departmentId !== 'all') {
    staffMatch.department = departmentId;
  }
  if (pfStatus === 'withPF') {
    staffMatch.pfNo = { $exists: true, $nin: [null, ''] };
  } else if (pfStatus === 'withoutPF') {
    staffMatch.$or = [{ pfNo: { $exists: false } }, { pfNo: null }, { pfNo: '' }];
  }

  const matchingStaff = await Staff.find(staffMatch).select('_id').lean();
  const staffIds = matchingStaff.map((s) => s._id);

  const [salaries, salaryStructure] = await Promise.all([
    Salary.find({ office: officeId, month, year, staff: { $in: staffIds } })
      .populate({
        path: 'staff',
        select: 'fullName pfNo esiNo department',
        populate: { path: 'department', select: 'name' },
      })
      .lean(),
    SalaryStructure.findOne({ office: officeId }).lean(),
  ]);

  if (!salaries.length) {
    throw new ApiError(404, 'Not Found!', 'No salaries found for the given filters.');
  }
  if (!salaryStructure) {
    throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  }

  const columnDefs = [
    { header: 'SL NO', key: 'slNo', summable: false },
    { header: 'NAME', key: 'name', summable: false },
    { header: 'DEPARTMENT', key: 'department', summable: false },
    { header: 'RATE', key: 'rate', summable: false },
    { header: 'NOD', key: 'nod', summable: true },
    { header: 'BASIC', key: 'basic', summable: true },
  ];

  if (salaryStructure.hra?.enabled) {
    columnDefs.push({ header: 'HRA', key: 'hra', summable: true });
  }
  if (salaryStructure.specialAllowance?.enabled) {
    columnDefs.push({ header: 'SPL ALLOWANCE', key: 'splAllowance', summable: true });
  }
  if (salaryStructure.otherAllowance?.enabled) {
    columnDefs.push({ header: 'OTHER ALLOW', key: 'otherAllowance', summable: true });
  }

  columnDefs.push({ header: 'GROSS', key: 'gross', summable: true });

  if (salaryStructure.conveyance?.enabled) {
    columnDefs.push({ header: 'CONV', key: 'conv', summable: true });
  }

  columnDefs.push({ header: 'TOTAL GROSS', key: 'totalGross', summable: true });

  if (salaryStructure.pf?.enabled) {
    columnDefs.push({ header: 'PF', key: 'pf', summable: true });
  }
  if (salaryStructure.esi?.enabled) {
    columnDefs.push({ header: 'ESI', key: 'esi', summable: true });
  }
  if (salaryStructure.pTax?.enabled) {
    columnDefs.push({ header: 'P TAX', key: 'pTax', summable: true });
  }
  if (salaryStructure.lwf?.enabled) {
    columnDefs.push({ header: 'L.W.F', key: 'lwf', summable: true });
  }

  columnDefs.push({ header: 'LESS ADVANCE', key: 'lessAdvance', summable: true });
  if (salaryStructure.overtime?.enabled) {
    columnDefs.push({ header: 'OT', key: 'overtime', summable: true });
  }
  columnDefs.push({ header: 'TD', key: 'td', summable: true });
  columnDefs.push({ header: 'NET', key: 'net', summable: true });

  const rows = salaries.map((s, i) => {
    const gross = getGrossWages(s);

    return {
      slNo: i + 1,
      name: s.staff?.fullName || '-',
      department: s.staff?.department?.name || '-',
      rate: s.baseSalary,
      nod: s.workedDays ?? 0,
      basic: roundInt(s.breakdown?.basic),
      hra: roundInt(s.breakdown?.hra),
      splAllowance: round2(s.breakdown?.specialAllowance),
      otherAllowance: round2(s.breakdown?.otherAllowance),
      gross: roundInt(gross),
      conv: round2(s.breakdown?.conveyance),
      totalGross: roundInt(s.grossSalary),
      pf: roundInt(s.breakdown?.pf),
      esi: roundInt(s.breakdown?.esi),
      pTax: round2(s.breakdown?.pTax),
      lwf: round2(s.breakdown?.lwf),
      lessAdvance: round2(s.breakdown?.advanceDeduction),
      td: round2(s.deductions),
      overtime: round2(s.breakdown?.overtime),
      net: s.netSalary,
    };
  });

  const totals = columnDefs.reduce((acc, col) => {
    if (col.summable) {
      acc[col.key] = rows.reduce((sum, r) => sum + (Number(r[col.key]) || 0), 0);
    }
    return acc;
  }, {});

  return { columns: columnDefs, rows, totals };
};

export const generateSalaryRegisterPdf = async (officeId, month, year, filters = {}) => {
  const { departmentId, pfStatus } = filters;

  const staffMatch = { office: officeId };
  if (departmentId && departmentId !== 'all') staffMatch.department = departmentId;
  if (pfStatus === 'withPF') staffMatch.pfNo = { $exists: true, $nin: [null, ''] };
  else if (pfStatus === 'withoutPF') staffMatch.$or = [{ pfNo: { $exists: false } }, { pfNo: null }, { pfNo: '' }];

  const matchingStaff = await Staff.find(staffMatch).select('_id').lean();
  const staffIds = matchingStaff.map((s) => s._id);

  const [salaries, salaryStructure] = await Promise.all([
    Salary.find({ office: officeId, month, year, staff: { $in: staffIds } })
      .populate('office', 'name')
      .populate({
        path: 'staff',
        select: 'fullName pfNo esiNo department',
        populate: { path: 'department', select: 'name' },
      })
      .lean(),
    SalaryStructure.findOne({ office: officeId }).lean(),
  ]);

  if (!salaries.length) {
    throw new ApiError(404, 'Not Found!', 'No salaries found for the given filters.');
  }
  if (!salaryStructure) {
    throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  }

  const officeName = salaries[0].office?.name || '';

  const columnDefs = [
    { header: 'SL NO', getValue: (_s, i) => i + 1 },
    { header: 'NAME', getValue: (s) => s.staff?.fullName || '-' },
    { header: 'DEPARTMENT', getValue: (s) => s.staff?.department?.name || '-' },
    { header: 'RATE', getValue: (s) => s.baseSalary },
    { header: 'NOD', getValue: (s) => s.workedDays ?? 0 },
    { header: 'BASIC', getValue: (s) => safeRound(s.breakdown?.basic) },
  ];

  if (salaryStructure.hra?.enabled) {
    columnDefs.push({ header: 'HRA', getValue: (s) => safeRound(s.breakdown?.hra) });
  }
  if (salaryStructure.specialAllowance?.enabled) {
    columnDefs.push({ header: 'SPL ALLOW', getValue: (s) => safeToFixed(s.breakdown?.specialAllowance) });
  }
  if (salaryStructure.otherAllowance?.enabled) {
    columnDefs.push({ header: 'Other Allow', getValue: (s) => safeToFixed(s.breakdown?.otherAllowance) });
  }

  columnDefs.push({
    header: 'Gross Wages',
    getValue: (s) => safeRound(getGrossWages(s)),
  });

  if (salaryStructure.conveyance?.enabled) {
    columnDefs.push({ header: 'CONV', getValue: (s) => safeToFixed(s.breakdown?.conveyance) });
  }

  columnDefs.push({ header: 'TOTAL GROSS', getValue: (s) => safeRound(s.grossSalary) });

  if (salaryStructure.pf?.enabled) {
    columnDefs.push({ header: 'PF', getValue: (s) => safeRound(s.breakdown?.pf) });
  }
  if (salaryStructure.esi?.enabled) {
    columnDefs.push({ header: 'ESI', getValue: (s) => safeRound(s.breakdown?.esi) });
  }
  if (salaryStructure.pTax?.enabled) {
    columnDefs.push({ header: 'P TAX', getValue: (s) => safeToFixed(s.breakdown?.pTax) });
  }
  if (salaryStructure.lwf?.enabled) {
    columnDefs.push({ header: 'LWF', getValue: (s) => safeToFixed(s.breakdown?.lwf) });
  }

  columnDefs.push({ header: 'ADV.', getValue: (s) => safeToFixed(s.breakdown?.advanceDeduction) });
  if (salaryStructure.overtime?.enabled) {
    columnDefs.push({ header: 'OT', getValue: (s) => safeToFixed(s.breakdown?.overtime) });
  }
  columnDefs.push({ header: 'TD', getValue: (s) => safeToFixed(s.deductions) });
  columnDefs.push({ header: 'Net Amt.', getValue: (s) => s.netSalary });

  const doc = new jsPDF({ format: 'a4', orientation: 'l' });
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();

  doc.setFont('times', 'bold');
  doc.setFontSize(14);
  doc.text(`SALARY REGISTER — ${format(new Date(year, month - 1), 'MMMM').toUpperCase()} ${year}`, pageWidth / 2, 10, {
    align: 'center',
  });
  doc.setFontSize(10);
  doc.text(officeName, pageWidth / 2, 15, { align: 'center' });

  const headers = [columnDefs.map((col) => col.header)];
  const rows = salaries.map((s, i) => columnDefs.map((col) => col.getValue(s, i)));

  autoTable(doc, {
    startY: 20,
    head: headers,
    body: rows,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [46, 134, 171], fontSize: 7 },
    showHead: 'everyPage',
    didDrawPage: (data) => {
      doc.setFontSize(8);
      const generatedDate = `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
      const textWidth = doc.getTextWidth(generatedDate);
      doc.text(generatedDate, pageWidth - data.settings.margin.right - textWidth, pageHeight - 10);
      doc.text(`Page ${doc.internal.getNumberOfPages()}`, data.settings.margin.left, pageHeight - 10);
    },
  });

  return doc.output('arraybuffer');
};

async function creditHolidayLeavesFund(office, month, year, staff, amount) {
  try {
    const roundedAmount = Math.round(amount);
    if (roundedAmount <= 0) {
      return;
    }
    const existingFund = await HolidayFund.findOne({ office, month, year, staff });
    if (!existingFund) {
      // New entry
      await HolidayFund.create({ office, month, year, staff, amount: roundedAmount });
      await Office.findByIdAndUpdate(office, { $inc: { holidayFundBalance: roundedAmount } });
    } else if (existingFund.amount !== roundedAmount) {
      // Adjust difference if amount has changed
      const diff = roundedAmount - existingFund.amount;
      await HolidayFund.updateOne({ _id: existingFund._id }, { $set: { amount: roundedAmount } });
      await Office.findByIdAndUpdate(office, { $inc: { holidayFundBalance: diff } });
    }
  } catch (error) {
    logger.error('Error while crediting holiday leaves fund:', error);
  }
}

// Update Conveynance allowance
export const updateManualConveyanceForSalary = async (officeId, salaryId, conveyanceAmount) => {
  const salaryStructure = await SalaryStructure.findOne({ office: officeId });
  if (!salaryStructure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');

  if (!salaryStructure.conveyance?.enabled || salaryStructure.conveyance?.mode !== 'input') {
    throw new ApiError(
      400,
      'Bad Request',
      'Manual conveyance can only be set when Conveyance is enabled with mode "input" in Salary Structure settings.'
    );
  }

  const salary = await Salary.findOne({ _id: salaryId, office: officeId });
  if (!salary) throw new ApiError(404, 'Not Found!', 'Salary record not found for this office.');
  await assertSalaryNotLocked(officeId, salary.month, salary.year);
  const updatedSalary = await Salary.findOneAndUpdate(
    { _id: salaryId, office: officeId },
    {
      $set: {
        manualConveyance: conveyanceAmount,
        'breakdown.conveyance': conveyanceAmount,
      },
    },
    { new: true }
  )
    .populate('staff', 'fullName staffId')
    .lean();

  return updatedSalary;
};

export const updateManualAdvanceForSalary = async (officeId, salaryId, newAdvanceAmount) => {
  const salary = await Salary.findOne({ _id: salaryId, office: officeId }).lean();
  if (!salary) throw new ApiError(404, 'Not Found!', 'Salary record not found for this office.');
  await assertSalaryNotLocked(officeId, salary.month, salary.year);
  const oldAdvanceAmount = salary.breakdown?.advanceDeduction ?? 0;
  const diff = newAdvanceAmount - oldAdvanceAmount; // positive => is month e beshi advance kata hocche
  if (diff === 0) {
    return Salary.findById(salaryId).populate('staff', 'fullName staffId').lean();
  }
  const otherDeductions = (salary.deductions ?? 0) - oldAdvanceAmount;
  let newTotalDeductions = Math.round(otherDeductions + newAdvanceAmount);
  newTotalDeductions = Math.max(0, Math.min(newTotalDeductions, salary.grossSalary));
  const newNetSalary = Math.round(salary.grossSalary - newTotalDeductions);
  const updatedSalary = await Salary.findOneAndUpdate(
    { _id: salaryId, office: officeId },
    {
      $set: {
        'breakdown.advanceDeduction': newAdvanceAmount,
        deductions: newTotalDeductions,
        netSalary: newNetSalary,
      },
    },
    { new: true }
  )
    .populate('staff', 'fullName staffId')
    .lean();

  const staff = await Staff.findById(salary.staff);

  if (staff?.advanceSalary) {
    const adv = staff.advanceSalary;
    let updatedRemaining = adv.remainingAmount - diff;
    updatedRemaining = Math.max(0, updatedRemaining);
    if (adv.totalAmount) updatedRemaining = Math.min(updatedRemaining, adv.totalAmount);

    adv.remainingAmount = updatedRemaining;

    if (updatedRemaining <= 0) {
      staff.advanceSalary = undefined;
    }

    await staff.save({ validateModifiedOnly: true });
  }

  await AdvanceTransaction.create({
    office: officeId,
    staff: salary.staff,
    month: salary.month,
    year: salary.year,
    type: 'update',
    amount: Math.abs(diff),
    previousAmount: oldAdvanceAmount,
    newAmount: newAdvanceAmount,
    remarks: `Manual advance adjustment on ${salary.month}/${salary.year} payslip${
      !staff?.advanceSalary ? ' (no active advance record on staff — payslip only)' : ''
    }`,
  });

  return updatedSalary;
};

export const generateSalaryPdfConveyanceOT = async (officeId, staffId, month, year) => {
  const [salary, salaryStructure] = await Promise.all([
    Salary.findOne({ office: officeId, staff: staffId, month, year })
      .populate('office', 'name')
      .populate('staff', 'fullName pfNo esiNo')
      .lean(),
    SalaryStructure.findOne({ office: officeId }).lean(),
  ]);

  if (!salary) {
    throw new ApiError(404, 'Not Found!', 'Salary not found for the given staff and month.');
  }
  if (!salaryStructure) {
    throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  }

  const doc = new jsPDF({ format: 'a4', orientation: 'l' });
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();

  doc.setFont('times', 'bold');
  doc.setFontSize(14);
  doc.setLineWidth(0.5);
  doc.text(
    `PAY SLIP FOR THE MONTH OF ${format(new Date(salary.year, salary.month - 1), 'MMMM').toUpperCase()} - ${salary.year}`,
    pageWidth / 2,
    10,
    { align: 'center' }
  );
  doc.setLineWidth(0.1);
  doc.line(pageWidth * 0.3, 11, pageWidth * 0.7, 11);
  doc.setFontSize(10);
  doc.text(salary.office?.name, pageWidth / 2, 15, { align: 'center' });

  const columnDefs = buildConveyanceOTColumnDefs(salaryStructure, true);

  const headers = [columnDefs.map((col) => col.header)];
  const rows = [columnDefs.map((col) => col.getValue(salary))];

  autoTable(doc, {
    startY: 20,
    head: headers,
    body: rows,
    theme: 'grid',
    didDrawPage: (data) => {
      doc.setFontSize(8);
      const officeUseText = `For ${salary.office?.name || ''}`;
      const officeTextWidth = doc.getTextWidth(officeUseText);
      doc.text(officeUseText, pageWidth - data.settings.margin.right - officeTextWidth, data.cursor.y + 15);

      doc.setLineWidth(0.2);
      doc.setLineDashPattern([2, 1]);
      doc.line(
        data.settings.margin.left,
        data.cursor.y + 25,
        pageWidth - data.settings.margin.right,
        data.cursor.y + 25
      );

      const pageCount = doc.internal.getNumberOfPages();
      const footerText = `Page ${pageCount}`;
      const generatedDate = `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;

      doc.setFontSize(10);
      doc.text(footerText, data.settings.margin.left, pageHeight - 10);

      const textWidth = doc.getTextWidth(generatedDate);
      doc.text(generatedDate, pageWidth - data.settings.margin.right - textWidth, pageHeight - 10);
    },
  });

  return doc.output('arraybuffer');
};

export const generateSalaryByMonthConveyanceOT = async (officeId, month, year) => {
  const [salaries, salaryStructure] = await Promise.all([
    Salary.find({ office: officeId, month, year })
      .populate('office', 'name')
      .populate('staff', 'fullName pfNo esiNo')
      .lean(),
    SalaryStructure.findOne({ office: officeId }).lean(),
  ]);

  if (!salaries.length) {
    throw new ApiError(404, 'Not Found!', 'No salaries found for the given month.');
  }
  if (!salaryStructure) {
    throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  }

  const doc = new jsPDF({ format: 'a4', orientation: 'l' });
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();

  const columnDefs = buildConveyanceOTColumnDefs(salaryStructure, true);
  const headers = [columnDefs.map((col) => col.header)];

  let rowIndex = 0;
  let startY = 20;
  let footerPrinted = false;

  for (const salary of salaries) {
    if (rowIndex > 0 && rowIndex % 3 === 0) {
      doc.addPage();
      startY = 20;
      footerPrinted = false;
    }
    doc.setFont('times', 'bold');
    doc.setFontSize(14);
    doc.setLineWidth(0.5);

    doc.text(
      `PAY SLIP FOR THE MONTH OF ${format(new Date(salary.year, salary.month - 1), 'MMMM').toUpperCase()} - ${salary.year}`,
      pageWidth / 2,
      startY - 10,
      { align: 'center' }
    );
    doc.setLineWidth(0.1);
    doc.setLineDashPattern([0, 0]);
    doc.line(pageWidth * 0.3, startY - 9, pageWidth * 0.7, startY - 9);
    doc.setFontSize(10);
    doc.text(salary.office?.name, pageWidth / 2, startY - 5, { align: 'center' });

    const rows = [columnDefs.map((col) => col.getValue(salary))];

    autoTable(doc, {
      startY: startY,
      head: headers,
      body: rows,
      theme: 'grid',
      didDrawPage: (data) => {
        doc.setFontSize(8);
        const officeUseText = `For ${salary.office?.name || ''}`;
        const officeTextWidth = doc.getTextWidth(officeUseText);
        doc.text(officeUseText, pageWidth - data.settings.margin.right - officeTextWidth, data.cursor.y + 15);

        doc.setLineWidth(0.2);
        doc.setLineDashPattern([2, 1]);
        doc.line(
          data.settings.margin.left,
          data.cursor.y + 25,
          pageWidth - data.settings.margin.right,
          data.cursor.y + 25
        );

        if (!footerPrinted) {
          doc.setFontSize(10);
          doc.text(`Page ${doc.internal.getNumberOfPages()}`, data.settings.margin.left, pageHeight - 10);

          const generatedDate = `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
          const textWidth = doc.getTextWidth(generatedDate);
          doc.text(generatedDate, pageWidth - data.settings.margin.right - textWidth, pageHeight - 10);
          footerPrinted = true;
        }
      },
    });

    rowIndex++;
    startY = doc.lastAutoTable.finalY + 50;
  }

  return doc.output('arraybuffer');
};

function buildConveyanceOTColumnDefs(salaryStructure, singleStaffRateFormula) {
  const columnDefs = [
    { header: 'Name', getValue: (s) => s.staff?.fullName || '-' },
    {
      header: 'Rate',
      getValue: (s) => (singleStaffRateFormula ? Math.round(s.baseSalary / s.totalPayableDays) : s.baseSalary),
    },
    { header: 'W/D', getValue: (s) => s.workedDays ?? 0 },
    { header: 'BASIC', getValue: (s) => safeRound(s.breakdown?.basic) },
  ];

  if (salaryStructure.da?.enabled) {
    columnDefs.push({ header: 'DA', getValue: (s) => safeToFixed(s.breakdown?.da) });
  }
  if (salaryStructure.hra?.enabled) {
    columnDefs.push({ header: 'HRA', getValue: (s) => safeRound(s.breakdown?.hra) });
  }
  if (salaryStructure.specialAllowance?.enabled) {
    columnDefs.push({ header: 'SPL ALLOW', getValue: (s) => safeToFixed(s.breakdown?.specialAllowance) });
  }
  if (salaryStructure.otherAllowance?.enabled) {
    columnDefs.push({ header: 'Other Allowance', getValue: (s) => safeToFixed(s.breakdown?.otherAllowance) });
  }

  columnDefs.push({
    header: 'Gross Wages',
    getValue: (s) => safeRound(getGrossWages(s)),
  });

  // CONV always shown here (OT er jonno column lagbe, conveyance off thakleo)
  columnDefs.push({
    header: 'CONV',
    getValue: (s) => safeToFixed((s.breakdown?.conveyance ?? 0) + (s.breakdown?.overtime ?? 0)),
  });

  columnDefs.push({ header: 'TOTAL GROSS', getValue: (s) => safeRound(s.grossSalary) });

  if (salaryStructure.pf?.enabled) {
    columnDefs.push({ header: 'PF', getValue: (s) => safeRound(s.breakdown?.pf) });
  }
  if (salaryStructure.esi?.enabled) {
    columnDefs.push({ header: 'ESI', getValue: (s) => safeRound(s.breakdown?.esi) });
  }
  if (salaryStructure.pTax?.enabled) {
    columnDefs.push({ header: 'P TAX', getValue: (s) => safeToFixed(s.breakdown?.pTax) });
  }
  if (salaryStructure.lwf?.enabled) {
    columnDefs.push({ header: 'LWF', getValue: (s) => safeToFixed(s.breakdown?.lwf) });
  }

  columnDefs.push({ header: 'ADV.', getValue: (s) => safeToFixed(s.breakdown?.advanceDeduction) });

  // No OT column pushed here on purpose — that's the whole point of this variant.

  columnDefs.push({ header: 'TD', getValue: (s) => safeToFixed(s.deductions) });
  columnDefs.push({ header: 'Net Amt.', getValue: (s) => s.netSalary });

  return columnDefs;
}
