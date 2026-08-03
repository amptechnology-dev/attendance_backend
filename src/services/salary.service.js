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

const autoCalculateAllSalaryByMonth = async (officeId, month, year) => {
  try {
    const alreadyCalculated = await SalaryCalculation.findOne({
      office: officeId,
      month,
      year,
      locked: true,
    });

    if (alreadyCalculated) {
      throw new Error(`Salary for ${month}/${year} has already been calculated.`);
    }
    const salaryStructure = await SalaryStructure.findOne({ office: officeId });
    if (!salaryStructure) throw new Error('Salary configuration not found.');
    const { startDate: monthStartDate, endDate: monthEndDate } = getMonthBoundariesFormatted(month, year);

    const [staffList, dutyTiming] = await Promise.all([
      Staff.find({ office: officeId }).lean(),
      DutyTiming.findOne({ office: officeId }),
    ]);
    if (!staffList.length) throw new Error('No staff found for the given office.');

    const daysInMonth = getDaysInMonth(new Date(year, month - 1));
    const dailyWorkHours = parseInt(dutyTiming.endTime.split(':')[0]) - parseInt(dutyTiming.startTime.split(':')[0]);

    const halfDayAllowed =
      Number.isFinite(dutyTiming.halfDayAllowed) && dutyTiming.halfDayAllowed >= 0 ? dutyTiming.halfDayAllowed : 2;

    // helper: normalize a date to a YYYY-MM-DD key so we can look up "the next day"
    const toDateKey = (date) => new Date(date).toISOString().slice(0, 10);

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

        // sort chronologically + map by date so we can check "the next day's" status for week-off rule
        const sortedAttendance = [...attendanceData].sort((a, b) => new Date(a.date) - new Date(b.date));
        const attendanceByDate = new Map(sortedAttendance.map((a) => [toDateKey(a.date), a]));

        let totalFullDays = 0,
          totalHalfDays = 0,
          totalHourPay = 0,
          overtimeHours = 0,
          totalPaidLeaves = 0,
          totalUnpaidLeaves = 0,
          totalHourlyDays = 0,
          totalWeekOffDays = 0, // paid week-offs — counted in W/D
          totalUnpaidWeekOffDays = 0; // week-off followed by unadjusted Absent — NOT counted in W/D

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
          } else if (attendance.status === 'full-day') {
            totalFullDays++;
          } else if (attendance.status === 'half-day') {
            totalHalfDays++;
          } else if (attendance.status === 'week-off') {
            // Rule: week-off is paid UNLESS the very next day is an unadjusted Absent —
            // in that case the week-off itself becomes unpaid too.
            const nextDate = new Date(attendance.date);
            nextDate.setDate(nextDate.getDate() + 1);
            const nextDayAttendance = attendanceByDate.get(toDateKey(nextDate));

            const nextDayIsUnadjustedAbsent =
              nextDayAttendance?.status === 'absent' &&
              nextDayAttendance?.hrAdjustments?.adjustments === 'None';

            if (nextDayIsUnadjustedAbsent) {
              totalUnpaidWeekOffDays++;
            } else {
              totalWeekOffDays++;
            }
          } else if (attendance.status === 'absent' || attendance.status === 'present') {
            attendance.leaveStatus === 'paid' ? totalPaidLeaves++ : totalUnpaidLeaves++;
          }
          // 'holiday' status still intentionally falls through — unrelated to this change,
          // handled separately below via the Leave collection (holidayLeaves).
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

        if (!totalFullDays && !totalHalfDays && !totalHourPay && !totalWeekOffDays) {
          return { staffId: staff._id, message: 'No attendance recorded. Skipping salary calculation.' };
        }

        const forgivenHalfDays = Math.min(halfDayAllowed, totalHalfDays);
        const extraHalfDays = totalHalfDays - forgivenHalfDays;
        const unpaidHalfDays = extraHalfDays * 0.5;

        const totalUnpaidDays = totalUnpaidLeaves + holidayLeavesCount + unpaidHalfDays + totalUnpaidWeekOffDays;

        // W/D (workedDays): Full-day + Half-day (forgiven/extra) + Paid Leaves + PAID Week-Off only
        const workedDays =
          totalFullDays + forgivenHalfDays + extraHalfDays * 0.5 + totalPaidLeaves + totalWeekOffDays;

        // paidDays feeds the money math (perDay gross, basic-on-total, etc.)
        // kept as the SAME number as workedDays — single source of truth,
        // so W/D shown on payslip/Excel always matches what gross salary was based on.
        const paidDays = workedDays;

        const dailyRate = staff.monthlySalary / daysInMonth;
        const hourlyPay = totalHourPay * (dailyRate / dailyWorkHours);
        const overtimePay = overtimeHours * overtimeRate;
        const bonus = 0;

        const baseSalary = staff.monthlySalary;

        // ---------- GROSS SALARY ----------
        let grossSalary;
        let leaveDeduction = 0;

        if (salaryStructure.grossSalary.calculationType === 'perDay') {
          grossSalary = Math.round(
            dailyRate * paidDays - totalHourlyDays * dailyRate + hourlyPay + overtimePay + bonus
          );
        } else {
          grossSalary = Math.round(baseSalary - totalHourlyDays * dailyRate + hourlyPay + overtimePay + bonus);
          leaveDeduction = Math.min(dailyRate * totalUnpaidDays, baseSalary);
        }

        // ---------- BASIC SALARY ----------
        let basic;
        if (salaryStructure.basicSalary.calculationType === 'onTotalSalary') {
          const basicDailyRate = ((salaryStructure.basicSalary.percentage / 100) * baseSalary) / daysInMonth;
          basic = basicDailyRate * paidDays;
        } else {
          basic = (salaryStructure.basicSalary.percentage / 100) * grossSalary;
        }

        // ---------- DA ----------
        const da = salaryStructure.da.enabled ? (salaryStructure.da.percentage / 100) * basic : 0;
        // ---------- OTHER ALLOWANCE ----------
        const otherAllowance = salaryStructure.otherAllowance.enabled
          ? (salaryStructure.otherAllowance.percentage / 100) * basic
          : 0;

        // ---------- HRA ----------
        let hra = 0;
        if (salaryStructure.hra.enabled) {
          const hraBase =
            salaryStructure.hra.calculateOn === 'gross'
              ? grossSalary
              : salaryStructure.hra.calculateOn === 'basicPlusDa'
                ? basic + da
                : basic;
          hra = (salaryStructure.hra.percentage / 100) * hraBase;
        }

        // ---------- CONVEYANCE ----------
        let conveyance = 0;
        if (salaryStructure.conveyance.enabled) {
          if (salaryStructure.conveyance.mode === 'readonly') {
            conveyance = (salaryStructure.conveyance.percentage / 100) * grossSalary;
          } else {
            // TODO: wire manual conveyance amount source (staff.conveyanceAmount or monthly override)
            conveyance = 0;
          }
        }

        // ---------- SPECIAL ALLOWANCE ----------
        const specialAllowance = salaryStructure.specialAllowance.enabled
          ? Math.max(0, grossSalary - basic - da - hra)
          : 0;

        // ---------- PF ----------
        let pfDeduction = 0;
        if (salaryStructure.pf.enabled && staff.pfNo) {
          const pfBase = salaryStructure.pf.calculateOn === 'basicPlusDa' ? basic + da : basic;
          const pfWage = Math.min(pfBase, salaryStructure.pf.wageCeiling);
          pfDeduction = (salaryStructure.pf.rate / 100) * pfWage;
        }

        // ---------- ESI ----------
        let esiDeduction = 0;
        if (salaryStructure.esi.enabled && staff.esiNo && baseSalary <= salaryStructure.esi.wageCeiling) {
          esiDeduction = (salaryStructure.esi.rate / 100) * baseSalary;
        }

        // ---------- PTAX ----------
        const pTax = salaryStructure.pTax.enabled ? calculatePTax(grossSalary) : 0;

        // ---------- LWF ----------
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

        // Deduct Advance
        let advanceDeduction = 0;
        if (netSalary >= staff.advanceSalary?.monthlyDeduction) {
          advanceDeduction = await deductAdvanceSalary(staff._id, month, year);
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

        if (salaryStructure.esi.enabled && staff.esiNo) setFields['breakdown.esi'] = esiDeduction;
        else unsetFields['breakdown.esi'] = '';

        if (salaryStructure.pf.enabled && staff.pfNo) setFields['breakdown.pf'] = pfDeduction;
        else unsetFields['breakdown.pf'] = '';

        if (salaryStructure.pTax.enabled) setFields['breakdown.pTax'] = pTax;
        else unsetFields['breakdown.pTax'] = '';

        if (salaryStructure.lwf.enabled) setFields['breakdown.lwf'] = lwfDeduction;
        else unsetFields['breakdown.lwf'] = '';

        if (totalHourlyDays > 0) setFields['breakdown.hourlyPay'] = hourlyPay;
        else unsetFields['breakdown.hourlyPay'] = '';

        unsetFields['breakdown.bonus'] = '';

        if (overtimeHours > 0) setFields['breakdown.overtime'] = overtimePay;
        else unsetFields['breakdown.overtime'] = '';

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

    await SalaryCalculation.create({
      office: officeId,
      month,
      year,
      locked: true,
      calculatedBy: null,
    });

    return results;
  } catch (error) {
    logger.error('Error while auto calculating salary:', error);
    throw new Error(error);
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

export const saveAdvanceSalary = async (
  staffId,
  totalAmount,
  remainingAmount,
  remainingMonths,
  remarks = '',
  pauseTill = undefined,
  action = 'update'
) => {
  const staff = await Staff.findById(staffId);
  if (!staff) throw new Error('Staff not found');

  if (action === 'add') {
    if (staff.advanceSalary && staff.advanceSalary.remainingAmount > 0) {
      throw new ApiError(400, 'Unpaid advance found!', [
        { message: 'Staff already has a pending advance. Please clear it first.' },
      ]);
    }

    const monthlyDeduction = Math.ceil(remainingAmount / (remainingMonths || 1));
    staff.advanceSalary = {
      totalAmount,
      remainingAmount,
      remainingMonths,
      monthlyDeduction,
      remarks,
    };
    await staff.save();
    await AdvanceTransaction.create({
      office: staff.office,
      staff: staffId,
      type: 'add',
      amount: totalAmount,
      newMonths: remainingMonths,
      remarks,
    });
    return staff.advanceSalary;
  }

  if (action === 'update') {
    if (!staff.advanceSalary) {
      throw new ApiError(400, 'No advance found!', [{ message: 'Staff does not have an advance.' }]);
    }
    const oldRemaining = staff.advanceSalary.remainingAmount;
    const oldMonths = staff.advanceSalary.remainingMonths;
    const updatedRemaining = Math.max(0, remainingAmount);
    const updatedMonths = Math.max(0, remainingMonths);

    if (updatedRemaining == 0 && updatedMonths == 0) {
      staff.advanceSalary = undefined;
    } else {
      staff.advanceSalary.remainingAmount = updatedRemaining;
      staff.advanceSalary.remainingMonths = updatedMonths;
      staff.advanceSalary.monthlyDeduction = updatedMonths > 0 ? Math.ceil(updatedRemaining / updatedMonths) : 0;
      staff.advanceSalary.remarks = remarks;
      staff.advanceSalary.pauseTill = pauseTill;
    }
    await staff.save();

    await AdvanceTransaction.create({
      office: staff.office,
      staff: staffId,
      type: 'update',
      amount: Math.abs(updatedRemaining - oldRemaining),
      remarks,
      previousAmount: oldRemaining,
      newAmount: updatedRemaining,
      previousMonths: oldMonths,
      newMonths: updatedMonths,
    });
    return staff.advanceSalary;
  }
  throw new Error(`Unsupported action type: ${action}`);
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
async function deductAdvanceSalary(staffId, month = null, year = null) {
  const staff = await Staff.findById(staffId);
  if (!staff.advanceSalary || staff.advanceSalary.remainingMonths <= 0 || !staff.advanceSalary.remainingAmount) {
    return 0; // No deduction needed
  }
  // Check if advance salary deduction is paused
  if (staff.advanceSalary.pauseTill && new Date(year, month, 1) < staff.advanceSalary.pauseTill) {
    return 0;
  }

  // Check if an advance salary deduction has already been made for this month
  const existingDeduction = await AdvanceTransaction.findOne({
    staff: staffId,
    type: 'deduct',
    month,
    year,
  });

  if (existingDeduction) {
    return existingDeduction.amount; // Return the already deducted amount
  }

  const deduction = staff.advanceSalary.monthlyDeduction;

  // Update remaining amount and months
  staff.advanceSalary.remainingAmount -= deduction;
  staff.advanceSalary.remainingMonths -= 1;

  // If fully paid, remove advance salary
  if (staff.advanceSalary.remainingMonths <= 0) {
    staff.advanceSalary = undefined;
  }

  await staff.save(); // Save updated staff record

  try {
    AdvanceTransaction.create({
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
    return 0;
  }

  return deduction; // Return the deducted amount
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
    `PAY SLIP FOR THE MONTH OF ${format(new Date(salary.year, salary.month - 1), 'MMMM').toUpperCase()} - ${salary.year}`,
    pageWidth / 2,
    10,
    { align: 'center' }
  );
  doc.setLineWidth(0.1);
  doc.line(pageWidth * 0.3, 11, pageWidth * 0.7, 11);
  doc.setFontSize(10);
  doc.text(salary.office?.name, pageWidth / 2, 15, { align: 'center' });

  // ================================================================
  // Column order fixed to match the office's printed pay-slip format:
  // Name, Rate, W/D, BASIC, DA, HRA, SPL ALLOW, Other Allowance,
  // Gross Wages, CONV, TOTAL GROSS, PF, ESI, P TAX, LWF, ADV., TD, Net Amt.
  //
  // - Each optional column only renders when its toggle is enabled in
  //   Salary Structure settings; disabled ones never appear (not even
  //   as 0), so the printed layout matches whichever components this
  //   office actually uses.
  // - ADV. is always shown: breakdown.advanceDeduction is a real
  //   schema field with `default: 0`, so it's read straight from the
  //   DB rather than conditionally hidden.
  // - TD = Total Deduction, backed by Salary.deductions (already sums
  //   PF + ESI + PTax + LWF + leave deduction + advance deduction).
  //   Always shown, same reasoning as ADV.
  // ================================================================
  const columnDefs = [
    { header: 'Name', getValue: (s) => s.staff?.fullName || '-' },
    { header: 'Rate', getValue: (s) => Math.round(s.baseSalary / s.totalPayableDays) },
    { header: 'W/D', getValue: (s) => s.workedDays ?? 0 },
    { header: 'BASIC', getValue: (s) => safeToFixed(s.breakdown?.basic) },
  ];

  if (salaryStructure.da?.enabled) {
    columnDefs.push({ header: 'DA', getValue: (s) => safeToFixed(s.breakdown?.da) });
  }
  if (salaryStructure.hra?.enabled) {
    columnDefs.push({ header: 'HRA', getValue: (s) => safeToFixed(s.breakdown?.hra) });
  }
  if (salaryStructure.specialAllowance?.enabled) {
    columnDefs.push({ header: 'SPL ALLOW', getValue: (s) => safeToFixed(s.breakdown?.specialAllowance) });
  }
  if (salaryStructure.otherAllowance?.enabled) {
    columnDefs.push({ header: 'Other Allowance', getValue: (s) => safeToFixed(s.breakdown?.otherAllowance) });
  }

  // Gross Wages = earnings before conveyance is folded in
  columnDefs.push({
    header: 'Gross Wages',
    getValue: (s) =>
      safeToFixed(
        (s.breakdown?.basic ?? 0) +
          (s.breakdown?.da ?? 0) +
          (s.breakdown?.hra ?? 0) +
          (s.breakdown?.otherAllowance ?? 0) +
          (s.breakdown?.specialAllowance ?? 0)
      ),
  });

  if (salaryStructure.conveyance?.enabled) {
    columnDefs.push({ header: 'CONV', getValue: (s) => safeToFixed(s.breakdown?.conveyance) });
  }

  columnDefs.push({ header: 'TOTAL GROSS', getValue: (s) => safeToFixed(s.grossSalary) });

  if (salaryStructure.pf?.enabled) {
    columnDefs.push({ header: 'PF', getValue: (s) => safeToFixed(s.breakdown?.pf) });
  }
  if (salaryStructure.esi?.enabled) {
    columnDefs.push({ header: 'ESI', getValue: (s) => safeToFixed(s.breakdown?.esi) });
  }
  if (salaryStructure.pTax?.enabled) {
    columnDefs.push({ header: 'P TAX', getValue: (s) => safeToFixed(s.breakdown?.pTax) });
  }
  if (salaryStructure.lwf?.enabled) {
    columnDefs.push({ header: 'LWF', getValue: (s) => safeToFixed(s.breakdown?.lwf) });
  }

  // Always shown — real schema field with a default, not a toggle.
  columnDefs.push({ header: 'ADV.', getValue: (s) => safeToFixed(s.breakdown?.advanceDeduction) });

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

  // Same fixed column order as generateSalaryPdf (see comments there).
  const columnDefs = [
    { header: 'Name', getValue: (s) => s.staff?.fullName || '-' },
    { header: 'Rate', getValue: (s) => s.baseSalary },
    { header: 'W/D', getValue: (s) => s.workedDays ?? 0 },
    { header: 'BASIC', getValue: (s) => safeToFixed(s.breakdown?.basic) },
  ];

  if (salaryStructure.da?.enabled) {
    columnDefs.push({ header: 'DA', getValue: (s) => safeToFixed(s.breakdown?.da) });
  }
  if (salaryStructure.hra?.enabled) {
    columnDefs.push({ header: 'HRA', getValue: (s) => safeToFixed(s.breakdown?.hra) });
  }
  if (salaryStructure.specialAllowance?.enabled) {
    columnDefs.push({ header: 'SPL ALLOW', getValue: (s) => safeToFixed(s.breakdown?.specialAllowance) });
  }
  if (salaryStructure.otherAllowance?.enabled) {
    columnDefs.push({ header: 'Other Allowance', getValue: (s) => safeToFixed(s.breakdown?.otherAllowance) });
  }

  columnDefs.push({
    header: 'Gross Wages',
    getValue: (s) =>
      safeToFixed(
        (s.breakdown?.basic ?? 0) +
          (s.breakdown?.da ?? 0) +
          (s.breakdown?.hra ?? 0) +
          (s.breakdown?.otherAllowance ?? 0) +
          (s.breakdown?.specialAllowance ?? 0)
      ),
  });

  if (salaryStructure.conveyance?.enabled) {
    columnDefs.push({ header: 'CONV', getValue: (s) => safeToFixed(s.breakdown?.conveyance) });
  }

  columnDefs.push({ header: 'TOTAL GROSS', getValue: (s) => safeToFixed(s.grossSalary) });

  if (salaryStructure.pf?.enabled) {
    columnDefs.push({ header: 'PF', getValue: (s) => safeToFixed(s.breakdown?.pf) });
  }
  if (salaryStructure.esi?.enabled) {
    columnDefs.push({ header: 'ESI', getValue: (s) => safeToFixed(s.breakdown?.esi) });
  }
  if (salaryStructure.pTax?.enabled) {
    columnDefs.push({ header: 'P TAX', getValue: (s) => safeToFixed(s.breakdown?.pTax) });
  }
  if (salaryStructure.lwf?.enabled) {
    columnDefs.push({ header: 'LWF', getValue: (s) => safeToFixed(s.breakdown?.lwf) });
  }

  columnDefs.push({ header: 'ADV.', getValue: (s) => safeToFixed(s.breakdown?.advanceDeduction) });

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
    const gross =
      (s.breakdown?.basic ?? 0) +
      (s.breakdown?.da ?? 0) +
      (s.breakdown?.hra ?? 0) +
      (s.breakdown?.otherAllowance ?? 0) +
      (s.breakdown?.specialAllowance ?? 0);

    const rowData = {
      slNo: i + 1,
      name: s.staff?.fullName || '-',
      department: s.staff?.department?.name || '-',
      rate: s.baseSalary,
      nod: s.workedDays ?? 0,
      basic: round2(s.breakdown?.basic),
      hra: round2(s.breakdown?.hra),
      splAllowance: round2(s.breakdown?.specialAllowance),
      otherAllowance: round2(s.breakdown?.otherAllowance),
      gross: round2(gross),
      conv: round2(s.breakdown?.conveyance),
      totalGross: round2(s.grossSalary),
      pf: round2(s.breakdown?.pf),
      esi: round2(s.breakdown?.esi),
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

  // ---- Resolve which staff match the filters first ----
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
        populate: { path: 'department', select: 'name' }, // adjust field name if different
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
  columnDefs.push({ header: 'TD', key: 'td', summable: true });
  columnDefs.push({ header: 'NET', key: 'net', summable: true });

  const rows = salaries.map((s, i) => {
    const gross =
      (s.breakdown?.basic ?? 0) +
      (s.breakdown?.da ?? 0) +
      (s.breakdown?.hra ?? 0) +
      (s.breakdown?.otherAllowance ?? 0) +
      (s.breakdown?.specialAllowance ?? 0);

    return {
      slNo: i + 1,
      name: s.staff?.fullName || '-',
      department: s.staff?.department?.name || '-',
      rate: s.baseSalary,
      nod: s.workedDays ?? 0,
      basic: round2(s.breakdown?.basic),
      hra: round2(s.breakdown?.hra),
      splAllowance: round2(s.breakdown?.specialAllowance),
      otherAllowance: round2(s.breakdown?.otherAllowance),
      gross: round2(gross),
      conv: round2(s.breakdown?.conveyance),
      totalGross: round2(s.grossSalary),
      pf: round2(s.breakdown?.pf),
      esi: round2(s.breakdown?.esi),
      pTax: round2(s.breakdown?.pTax),
      lwf: round2(s.breakdown?.lwf),
      lessAdvance: round2(s.breakdown?.advanceDeduction),
      td: round2(s.deductions),
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

  // Same conditional column set as the Excel register — kept in sync
  // so PDF, Excel, and the web preview always show identical columns.
  const columnDefs = [
    { header: 'SL NO', getValue: (_s, i) => i + 1 },
    { header: 'NAME', getValue: (s) => s.staff?.fullName || '-' },
    { header: 'DEPARTMENT', getValue: (s) => s.staff?.department?.name || '-' },
    { header: 'RATE', getValue: (s) => s.baseSalary },
    { header: 'NOD', getValue: (s) => s.workedDays ?? 0 },
    { header: 'BASIC', getValue: (s) => safeToFixed(s.breakdown?.basic) },
  ];

  if (salaryStructure.hra?.enabled) {
    columnDefs.push({ header: 'HRA', getValue: (s) => safeToFixed(s.breakdown?.hra) });
  }
  if (salaryStructure.specialAllowance?.enabled) {
    columnDefs.push({ header: 'SPL ALLOW', getValue: (s) => safeToFixed(s.breakdown?.specialAllowance) });
  }
  if (salaryStructure.otherAllowance?.enabled) {
    columnDefs.push({ header: 'Other Allow', getValue: (s) => safeToFixed(s.breakdown?.otherAllowance) });
  }

  columnDefs.push({
    header: 'Gross Wages',
    getValue: (s) =>
      safeToFixed(
        (s.breakdown?.basic ?? 0) +
          (s.breakdown?.da ?? 0) +
          (s.breakdown?.hra ?? 0) +
          (s.breakdown?.otherAllowance ?? 0) +
          (s.breakdown?.specialAllowance ?? 0)
      ),
  });

  if (salaryStructure.conveyance?.enabled) {
    columnDefs.push({ header: 'CONV', getValue: (s) => safeToFixed(s.breakdown?.conveyance) });
  }

  columnDefs.push({ header: 'TOTAL GROSS', getValue: (s) => safeToFixed(s.grossSalary) });

  if (salaryStructure.pf?.enabled) {
    columnDefs.push({ header: 'PF', getValue: (s) => safeToFixed(s.breakdown?.pf) });
  }
  if (salaryStructure.esi?.enabled) {
    columnDefs.push({ header: 'ESI', getValue: (s) => safeToFixed(s.breakdown?.esi) });
  }
  if (salaryStructure.pTax?.enabled) {
    columnDefs.push({ header: 'P TAX', getValue: (s) => safeToFixed(s.breakdown?.pTax) });
  }
  if (salaryStructure.lwf?.enabled) {
    columnDefs.push({ header: 'LWF', getValue: (s) => safeToFixed(s.breakdown?.lwf) });
  }

  columnDefs.push({ header: 'ADV.', getValue: (s) => safeToFixed(s.breakdown?.advanceDeduction) });
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
    showHead: 'everyPage', // header repeats automatically on every new page
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
