import { Salary, SalaryStructure, AdvanceTransaction } from '../models/salary.model.js';
import { Staff } from '../models/staff.model.js';
import { Attendance } from '../models/attendance.model.js';
import { DutyTiming } from '../models/dutyTiming.model.js';
import { getDaysInMonth } from 'date-fns';
import logger from '../config/logger.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { Leave } from '../models/leave.model.js';
import { HolidayFund } from '../models/holidayFund.model.js';
import { Office } from '../models/office.model.js';
import { getMonthBoundariesFormatted } from '../utils/dateTime.utils.js';
import { ApiError } from '../utils/responseHandler.js';

let calculationStatus = {};

export const autoCalculateAllSalary = async (officeId, month, year) => {
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

const autoCalculateAllSalaryByMonth = async (officeId, month, year) => {
  try {
    const salaryStructure = await SalaryStructure.findOne({ office: officeId });
    if (!salaryStructure) throw new Error('Salary configuration not found.');
    const { startDate: monthStartDate, endDate: monthEndDate } = getMonthBoundariesFormatted(month, year);

    const [staffList, dutyTiming] = await Promise.all([
      Staff.find({ office: officeId }).lean(),
      DutyTiming.findOne({ office: officeId }),
    ]);
    if (!staffList.length) throw new Error('No staff found for the given office.');

    const daysInMonth = getDaysInMonth(new Date(year, month - 1));
    const lateAllowed = dutyTiming.lateAllowed; //TODO: late allowed count
    const dailyWorkHours = parseInt(dutyTiming.endTime.split(':')[0]) - parseInt(dutyTiming.startTime.split(':')[0]);

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
          totalUnpaidLeaves = 0,
          totalHourlyDays = 0;

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
                totalHourlyDays++;
                totalHourPay += attendance.totalWorkTime;
                break;
            }
          } else if (attendance.status === 'full-day') {
            totalFullDays++;
          } else if (attendance.status === 'half-day') {
            totalHalfDays++;
          } else if (attendance.status === 'absent' || attendance.status === 'present') {
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
        const extraHalfDays = totalHalfDays - allowedHalfDays;
        const unpaidHalfDays = extraHalfDays * 0.5;
        const totalUnpaidDays = totalUnpaidLeaves + holidayLeavesCount + unpaidHalfDays;
        const dailyRate = staff.monthlySalary / daysInMonth;
        const hourlyPay = totalHourPay * (dailyRate / dailyWorkHours);

        const leaveDeduction = Math.min(dailyRate * totalUnpaidDays, staff.monthlySalary);

        // Base salary is full month salary
        const baseSalary = staff.monthlySalary;
        const overtimePay = overtimeHours * staff.overtimeRate;
        const bonus = 0; // TODO: calculate bonus
        const grossSalary = Math.round(baseSalary - totalHourlyDays * dailyRate + hourlyPay + overtimePay + bonus);

        const basic = (salaryStructure.basic_percentage / 100) * grossSalary;
        const hra = (salaryStructure.hra_allowance_percentage / 100) * grossSalary;
        const conveyance = (salaryStructure.conveyance_allowance_percentage / 100) * grossSalary;
        const specialAllowance = (salaryStructure.special_allowance_percentage / 100) * grossSalary;
        const otherAllowance = (salaryStructure.other_allowance_percentage / 100) * grossSalary;

        let pfDeduction = 0;
        if (staff.pfNo) {
          const pfWage = Math.min(basic, 15000); // cap at 15k
          pfDeduction = (salaryStructure.pf_rate / 100) * pfWage;
        }
        let esiDeduction = staff.esiNo && grossSalary <= 21000 ? (salaryStructure.esi_rate / 100) * grossSalary : 0;
        const pTax = getPtax(grossSalary);

        let totalDeductions = Math.round(esiDeduction + pfDeduction + pTax + leaveDeduction);
        totalDeductions = Math.min(totalDeductions, grossSalary);
        let netSalary = Math.round(grossSalary - totalDeductions);

        // Deduct Advance
        let advanceDeduction = 0;
        if (netSalary >= staff.advanceSalary?.monthlyDeduction) {
          // Deduct Advance if salary is greater than monthly deduction
          advanceDeduction = await deductAdvanceSalary(staff._id, month, year);
          totalDeductions += advanceDeduction;
          netSalary = Math.round(grossSalary - totalDeductions);
        }

        const unpaidHolidayLeaveDeduction = Math.min(holidayLeavesCount * dailyRate, grossSalary);
        // Save Salary Data
        await Salary.updateOne(
          { office: officeId, staff: staff._id, month, year },
          {
            baseSalary,
            totalPayableDays: daysInMonth,
            // totalWorkingDays: payableDays,
            attendanceDetails: { totalFullDays, totalHalfDays, totalHourPay, overtimeHours },
            leaves: {
              totalPaidLeaves,
              totalUnpaidLeaves,
              totalHolidayLeaves: holidayLeavesCount,
              leaveDeduction: Math.round(leaveDeduction),
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
  const salary = await Salary.findOne({ office: officeId, staff: staffId, month, year })
    .populate('office', 'name')
    .populate('staff', 'fullName pfNo esiNo')
    .lean();
  if (!salary) {
    throw new ApiError(404, 'Not Found!', 'Salary not found for the given staff and month.');
  }

  const doc = new jsPDF({ format: 'a4', orientation: 'l' });
  // Get the page height and width
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();

  doc.setFont('times', 'bold');
  // Company Details
  doc.setFontSize(14);
  doc.setLineWidth(0.5);

  doc.text(
    `PAY SLIP FOR THE MONTH OF ${format(new Date(salary.year, salary.month - 1), 'MMMM').toUpperCase()} - ${salary.year}`,
    pageWidth / 2,
    10,
    {
      align: 'center',
    }
  );
  doc.setLineWidth(0.1);
  doc.line(pageWidth * 0.3, 11, pageWidth * 0.7, 11);
  doc.setFontSize(10);
  doc.text(salary.office?.name, pageWidth / 2, 15, { align: 'center' });

  // Table headers
  const headers = [
    [
      'Employee',
      'Rate',
      'Shifts',
      'Basic',
      'Conv A',
      'HRA',
      'SA',
      'OA',
      'Gross',
      'PF',
      'ESI',
      'P.Tax',
      'LOP',
      'Adv',
      'Deduct',
      'Net',
    ],
  ];
  const rows = [
    [
      salary.staff.fullName,
      Math.round(salary.baseSalary / salary.totalPayableDays),
      salary.totalPayableDays,
      salary.breakdown.basic.toFixed(2),
      salary.breakdown.conveyance.toFixed(2),
      salary.breakdown.hra.toFixed(2),
      salary.breakdown.specialAllowance.toFixed(2),
      salary.breakdown.otherAllowance.toFixed(2),
      salary.grossSalary.toFixed(2),
      salary.breakdown.pf.toFixed(2),
      salary.breakdown.esi.toFixed(2),
      salary.breakdown.pTax.toFixed(2),
      salary.leaves.leaveDeduction.toFixed(2),
      salary.breakdown.advanceDeduction.toFixed(2),
      salary.deductions.toFixed(2),
      salary.netSalary,
    ],
  ];

  // Add table to the document
  autoTable(doc, {
    startY: 20,
    head: headers,
    body: rows,
    // styles: {
    //   fontSize: 8,
    // },
    theme: 'grid',
    didDrawPage: (data) => {
      // For official use only
      doc.setFontSize(8);
      const officeUseText = `For ${salary.office.name}`;
      const officeTextWidth = doc.getTextWidth(officeUseText);
      doc.text(officeUseText, pageWidth - data.settings.margin.right - officeTextWidth, data.cursor.y + 15);

      // End line
      doc.setLineWidth(0.2);
      doc.setLineDashPattern([2, 1]);
      doc.line(
        data.settings.margin.left,
        data.cursor.y + 25,
        pageWidth - data.settings.margin.right,
        data.cursor.y + 25
      );

      // Footer content
      const pageCount = doc.internal.getNumberOfPages();
      const footerText = `Page ${pageCount}`;
      const generatedDate = `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;

      // Add page number to the bottom left
      doc.setFontSize(10);
      doc.text(footerText, data.settings.margin.left, pageHeight - 10);

      // Add generated date to the bottom right
      const textWidth = doc.getTextWidth(generatedDate);
      doc.text(generatedDate, pageWidth - data.settings.margin.right - textWidth, pageHeight - 10);
    },
  });

  // Return the PDF buffer
  return doc.output('arraybuffer');
};

export const generateSalaryByMonth = async (officeId, month, year) => {
  const salaries = await Salary.find({ office: officeId, month, year })
    .populate('office', 'name')
    .populate('staff', 'fullName pfNo esiNo')
    .lean();

  if (!salaries.length) {
    throw new ApiError(404, 'Not Found!', 'No salaries found for the given month.');
  }

  const doc = new jsPDF({ format: 'a4', orientation: 'l' });
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();

  const headers = [
    [
      'Employee',
      'Rate',
      'Shifts',
      'PL',
      'Basic',
      'Conv Allow',
      'HRA',
      'Special Allow',
      'Other Allow',
      'Gross',
      'PF',
      'ESI',
      'P.Tax',
      'Deductions',
      'Net',
    ],
  ];

  let rowIndex = 0;
  let startY = 20;
  let footerPrinted = false;

  for (const salary of salaries) {
    if (rowIndex > 0 && rowIndex % 3 === 0) {
      doc.addPage();
      startY = 20; // Reset start position for new page
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

    const rows = [
      [
        salary.staff.fullName,
        salary.baseSalary,
        salary.attendanceDetails.totalFullDays + salary.attendanceDetails.totalHalfDays,
        salary.leaves.totalPaidLeaves,
        salary.breakdown.basic.toFixed(2),
        salary.breakdown.conveyance.toFixed(2),
        salary.breakdown.hra.toFixed(2),
        salary.breakdown.specialAllowance.toFixed(2),
        salary.breakdown.otherAllowance.toFixed(2),
        salary.grossSalary.toFixed(2),
        salary.breakdown.pf.toFixed(2),
        salary.breakdown.esi.toFixed(2),
        salary.breakdown.pTax.toFixed(2),
        salary.deductions.toFixed(2),
        salary.netSalary,
      ],
    ];

    autoTable(doc, {
      startY: startY,
      head: headers,
      body: rows,
      theme: 'grid',
      didDrawPage: (data) => {
        // For official use only
        doc.setFontSize(8);
        const officeUseText = `For ${salary.office.name}`;
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

        // Page footer
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

    // Increment rowIndex for the next salary
    rowIndex++;
    startY = doc.lastAutoTable.finalY + 50; // Adjust spacing between tables
  }

  // Return the PDF buffer
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
