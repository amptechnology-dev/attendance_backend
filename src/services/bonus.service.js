import { Salary, SalaryStructure, Bonus } from '../models/salary.model.js';
import { Staff } from '../models/staff.model.js';
import { SalaryCalculation } from '../models/salaryCalculation.model.js';
import { ApiError } from '../utils/responseHandler.js';
import { assertSalaryNotLocked } from './salary.service.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { Office } from '../models/office.model.js';

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;


const getPeriodMonths = (lastMonth, lastYear, backMonths) => {
  const months = [];
  let m = lastMonth;
  let y = lastYear;
  for (let i = 0; i < backMonths; i++) {
    months.unshift({ month: m, year: y });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return months;
};

const getTenureInMonths = (dateOfJoining, lastMonth, lastYear) => {
  const doj = new Date(dateOfJoining);
  const dojMonth = doj.getMonth() + 1;
  const dojYear = doj.getFullYear();
  return (lastYear - dojYear) * 12 + (lastMonth - dojMonth);
};

export const validateBonusConfig = (bonusConfig) => {
  if (!bonusConfig || !['manual', 'auto'].includes(bonusConfig.mode)) {
    throw new ApiError(400, 'Bad Request', 'bonus.mode must be either "manual" or "auto".');
  }

  if (bonusConfig.mode === 'auto') {
    const rules = bonusConfig.rules || [];
    if (!rules.length) {
      throw new ApiError(400, 'Bad Request', 'At least one bonus rule is required when mode is "auto".');
    }

    const seen = new Set();
    rules.forEach((rule, idx) => {
      if (!rule.lastMonth || rule.lastMonth < 1 || rule.lastMonth > 12) {
        throw new ApiError(400, 'Bad Request', `Rule #${idx + 1}: lastMonth must be between 1 and 12.`);
      }
      if (!rule.lastYear) {
        throw new ApiError(400, 'Bad Request', `Rule #${idx + 1}: lastYear is required.`);
      }
      if (!rule.backMonths || rule.backMonths < 1) {
        throw new ApiError(400, 'Bad Request', `Rule #${idx + 1}: backMonths must be at least 1.`);
      }
      if (rule.minTenureMonths === undefined || rule.minTenureMonths < 0) {
        throw new ApiError(400, 'Bad Request', `Rule #${idx + 1}: minTenureMonths must be 0 or more.`);
      }
      if (rule.percentage === undefined || rule.percentage < 0 || rule.percentage > 100) {
        throw new ApiError(400, 'Bad Request', `Rule #${idx + 1}: percentage must be between 0 and 100.`);
      }
      const key = `${rule.lastMonth}-${rule.lastYear}`;
      if (seen.has(key)) {
        throw new ApiError(400, 'Bad Request', `Duplicate bonus rule found for ${rule.lastMonth}/${rule.lastYear}.`);
      }
      seen.add(key);
    });
  }
};

// Months configured under auto mode — used to restrict the register page's month picker
export const getBonusSettingMonths = async (officeId) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  if (structure.bonus?.mode !== 'auto') return [];

  return (structure.bonus.rules || [])
    .map((r) => ({ month: r.lastMonth, year: r.lastYear }))
    .sort((a, b) => a.year - b.year || a.month - b.month);
};

export const calculateAutoBonusForMonth = async (officeId, month, year) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  if (structure.bonus?.mode !== 'auto') {
    throw new ApiError(400, 'Bad Request', 'Bonus mode is not set to "auto" for this office.');
  }

  const rule = (structure.bonus.rules || []).find(
    (r) => r.lastMonth === Number(month) && r.lastYear === Number(year)
  );
  if (!rule) {
    throw new ApiError(400, 'Bad Request', `No bonus rule configured for ${month}/${year}.`);
  }

  const periodMonths = getPeriodMonths(rule.lastMonth, rule.lastYear, rule.backMonths);
  // Last day of the earliest period month — used as the "must be joined before this" cutoff
  const periodStart = new Date(periodMonths[0].year, periodMonths[0].month - 1, 1);

  const staffList = await Staff.find({
    office: officeId,
    // dateOfJoining must be on/before the last day of the rule's lastMonth
    dateOfJoining: { $lte: new Date(rule.lastYear, rule.lastMonth, 0) },
    $or: [{ dateOfLeaving: null }, { dateOfLeaving: { $exists: false } }, { dateOfLeaving: { $gte: periodStart } }],
  }).lean();

  const salaryOrConditions = periodMonths.map(({ month: m, year: y }) => ({ month: m, year: y }));
  const eligibleStaffIds = [];

  for (const staff of staffList) {
    const tenureMonths = getTenureInMonths(staff.dateOfJoining, rule.lastMonth, rule.lastYear);
    if (tenureMonths < rule.minTenureMonths) continue;

    const salaries = await Salary.find({
      office: officeId,
      staff: staff._id,
      $or: salaryOrConditions,
    }).lean();

    if (!salaries.length) continue;

    // Bonus is calculated on net salary BEFORE advance deduction was subtracted
    const baseNetSalarySum = salaries.reduce((sum, s) => {
      const netBeforeAdvance = (s.netSalary || 0) + (s.breakdown?.advanceDeduction || 0);
      return sum + netBeforeAdvance;
    }, 0);

    const amount = round2((baseNetSalarySum * rule.percentage) / 100);

    await Bonus.findOneAndUpdate(
      { office: officeId, staff: staff._id, month: rule.lastMonth, year: rule.lastYear },
      {
        mode: 'auto',
        amount,
        percentage: rule.percentage,
        backMonths: rule.backMonths,
        minTenureMonths: rule.minTenureMonths,
        baseNetSalarySum: round2(baseNetSalarySum),
        monthsCounted: salaries.length,
      },
      { upsert: true, new: true }
    );

    eligibleStaffIds.push(staff._id);
  }

  // Drop stale auto bonus records for staff who are no longer eligible (e.g. rule was edited)
  await Bonus.deleteMany({
    office: officeId,
    month: rule.lastMonth,
    year: rule.lastYear,
    mode: 'auto',
    staff: { $nin: eligibleStaffIds },
  });
};

const groupByDepartment = async (records) => {
  const staffIds = records.map((r) => r.staff);
  const staffList = await Staff.find({ _id: { $in: staffIds } })
    .select('fullName department')
    .populate('department', 'name')
    .lean();

  const staffMap = new Map(staffList.map((s) => [String(s._id), s]));
  const groups = new Map();

  records.forEach((r) => {
    const staff = staffMap.get(String(r.staff));
    if (!staff) return;
    const deptName = staff.department?.name || 'Unassigned';
    if (!groups.has(deptName)) groups.set(deptName, []);
    groups.get(deptName).push({
      staffId: staff._id,
      staffName: staff.fullName,
      amount: r.amount,
      baseNetSalarySum: r.baseNetSalarySum,
      monthsCounted: r.monthsCounted,
      percentage: r.percentage,
      remarks: r.remarks || '',
    });
  });

  return Array.from(groups.entries()).map(([departmentName, staff]) => ({ departmentName, staff }));
};

export const getBonusRegister = async (officeId, month, year) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');

  const lock = await SalaryCalculation.findOne({ office: officeId, month, year }).lean();
  const locked = Boolean(lock?.locked);

  if (structure.bonus?.mode === 'auto') {
    await calculateAutoBonusForMonth(officeId, month, year);
    const records = await Bonus.find({ office: officeId, month, year, mode: 'auto' }).lean();
    const departments = await groupByDepartment(records);
    return { mode: 'auto', locked, departments };
  }

  // Manual mode: show every active staff, department wise, prefilled with any saved amount
  const staffList = await Staff.find({ office: officeId, status: 'active' })
    .select('fullName department')
    .populate('department', 'name')
    .lean();

  const existing = await Bonus.find({ office: officeId, month, year, mode: 'manual' }).lean();
  const existingMap = new Map(existing.map((e) => [String(e.staff), e]));

  const groups = new Map();
  staffList.forEach((staff) => {
    const deptName = staff.department?.name || 'Unassigned';
    if (!groups.has(deptName)) groups.set(deptName, []);
    const entry = existingMap.get(String(staff._id));
    groups.get(deptName).push({
      staffId: staff._id,
      staffName: staff.fullName,
      amount: entry?.amount ?? 0,
      remarks: entry?.remarks || '',
    });
  });

  const departments = Array.from(groups.entries()).map(([departmentName, staff]) => ({ departmentName, staff }));
  return { mode: 'manual', locked, departments };
};

export const saveManualBonusEntries = async (officeId, month, year, entries) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  if (structure.bonus?.mode !== 'manual') {
    throw new ApiError(400, 'Bad Request', 'Bonus mode is not set to "manual" for this office.');
  }
  if (!Array.isArray(entries) || !entries.length) {
    throw new ApiError(400, 'Bad Request', 'entries array is required.');
  }

  await assertSalaryNotLocked(officeId, month, year);

  const results = [];
  for (const entry of entries) {
    if (!entry.staffId) continue;
    const amount = Number(entry.amount) || 0;
    const updated = await Bonus.findOneAndUpdate(
      { office: officeId, staff: entry.staffId, month, year },
      { mode: 'manual', amount, remarks: entry.remarks || '' },
      { upsert: true, new: true }
    );
    results.push(updated);
  }
  return results;
};

const thinBorder = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

const safeToFixed = (value, decimals = 2) => {
  if (value === undefined || value === null || isNaN(value)) return (0).toFixed(decimals);
  return Number(value).toFixed(decimals);
};

const formatJoiningDate = (date) => (date ? format(new Date(date), 'dd-MM-yyyy') : '-');

// Builds the flat, sorted (department -> name) row list shared by both PDF and Excel exports.
const buildBonusRegisterRows = async (officeId, month, year) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');

  if (structure.bonus?.mode === 'auto') {
    await calculateAutoBonusForMonth(officeId, month, year);
  }

  const bonusRecords = await Bonus.find({ office: officeId, month, year, mode: structure.bonus?.mode }).lean();

  let staffList;
  if (structure.bonus?.mode === 'auto') {
    const eligibleStaffIds = bonusRecords.filter((b) => b.amount > 0).map((b) => b.staff);
    staffList = await Staff.find({ _id: { $in: eligibleStaffIds } })
      .select('fullName department dateOfJoining')
      .populate('department', 'name')
      .lean();
  } else {
    staffList = await Staff.find({ office: officeId, status: 'active' })
      .select('fullName department dateOfJoining')
      .populate('department', 'name')
      .lean();
  }

  const bonusByStaff = new Map(bonusRecords.map((b) => [String(b.staff), b]));

  const rows = staffList
    .map((staff) => {
      const bonus = bonusByStaff.get(String(staff._id));
      return {
        staffName: staff.fullName,
        departmentName: staff.department?.name || 'Unassigned',
        dateOfJoining: staff.dateOfJoining,
        amount: bonus?.amount ?? 0,
      };
    })
    .filter((r) => structure.bonus?.mode === 'auto' ? r.amount > 0 : true)
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName) || a.staffName.localeCompare(b.staffName));

  const office = await Office.findById(officeId).select('name').lean();

  return { rows, officeName: office?.name || '', mode: structure.bonus?.mode || 'manual' };
};

export const generateBonusRegisterPdf = async (officeId, month, year) => {
  const { rows, officeName } = await buildBonusRegisterRows(officeId, month, year);
  if (!rows.length) {
    throw new ApiError(404, 'Not Found!', 'No bonus records found for the given month.');
  }

  const doc = new jsPDF({ format: 'a4', orientation: 'l' });
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();

  doc.setFont('times', 'bold');
  doc.setFontSize(14);
  doc.text(`BONUS REGISTER — ${format(new Date(year, month - 1), 'MMMM').toUpperCase()} ${year}`, pageWidth / 2, 10, {
    align: 'center',
  });
  doc.setFontSize(10);
  doc.text(officeName, pageWidth / 2, 15, { align: 'center' });

  const headers = [['SL NO', 'NAME', 'DEPARTMENT', 'DATE OF JOINING', 'AMOUNT', 'RECEIVED DATE', 'SIGNATURE']];
  const body = rows.map((r, i) => [
    i + 1,
    r.staffName,
    r.departmentName,
    formatJoiningDate(r.dateOfJoining),
    safeToFixed(r.amount),
    '',
    '',
  ]);

  autoTable(doc, {
    startY: 20,
    head: headers,
    body,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [46, 134, 171], fontSize: 9 },
    columnStyles: {
      5: { minCellWidth: 35 },
      6: { minCellWidth: 35 },
    },
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

export const generateBonusRegisterExcel = async (officeId, month, year) => {
  const { rows, officeName } = await buildBonusRegisterRows(officeId, month, year);
  if (!rows.length) {
    throw new ApiError(404, 'Not Found!', 'No bonus records found for the given month.');
  }

  const columnDefs = [
    { header: 'SL NO', key: 'slNo', width: 8 },
    { header: 'NAME', key: 'name', width: 24 },
    { header: 'DEPARTMENT', key: 'department', width: 18 },
    { header: 'DATE OF JOINING', key: 'doj', width: 16 },
    { header: 'AMOUNT', key: 'amount', width: 12, sum: true },
    { header: 'RECEIVED DATE', key: 'receivedDate', width: 16 },
    { header: 'SIGNATURE', key: 'signature', width: 18 },
  ];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Bonus Register');
  const colCount = columnDefs.length;

  columnDefs.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width;
  });

  sheet.mergeCells(1, 1, 1, colCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = officeName?.toUpperCase() || 'COMPANY NAME';
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB39DDB' } };
  sheet.getRow(1).height = 20;

  sheet.mergeCells(2, 1, 2, colCount);
  const subtitleCell = sheet.getCell(2, 1);
  const monthLabel = format(new Date(year, month - 1), 'MMMM').toUpperCase();
  subtitleCell.value = `BONUS REGISTER ${monthLabel}'${String(year).slice(-2)}`;
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

  rows.forEach((r, i) => {
    const rowData = {
      slNo: i + 1,
      name: r.staffName,
      department: r.departmentName,
      doj: formatJoiningDate(r.dateOfJoining),
      amount: Math.round((Number(r.amount) || 0) * 100) / 100,
      receivedDate: '',
      signature: '',
    };

    const row = sheet.getRow(rowIndex);
    columnDefs.forEach((col, idx) => {
      const cell = row.getCell(idx + 1);
      cell.value = rowData[col.key];
      cell.font = { size: 9 };
      cell.border = thinBorder;
      cell.alignment = { horizontal: ['name', 'department'].includes(col.key) ? 'left' : 'center' };
    });
    row.height = 22;
    rowIndex++;
  });

  const lastDataRow = rowIndex - 1;

  const totalRow = sheet.getRow(rowIndex);
  sheet.mergeCells(rowIndex, 1, rowIndex, 3);

  const totalLabelCell = totalRow.getCell(1);
  totalLabelCell.value = 'TOTAL';
  totalLabelCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  totalLabelCell.alignment = { horizontal: 'center', vertical: 'middle' };
  totalLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
  totalLabelCell.border = thinBorder;

  columnDefs.forEach((col, idx) => {
    if (idx < 3) return;
    const cell = totalRow.getCell(idx + 1);
    const colLetter = sheet.getColumn(idx + 1).letter;

    if (col.sum) {
      cell.value = { formula: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})` };
    } else {
      cell.value = '';
    }
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
    cell.border = thinBorder;
  });
  totalRow.height = 18;

  return workbook.xlsx.writeBuffer();
};