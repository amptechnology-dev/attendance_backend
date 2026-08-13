import mongoose from 'mongoose';
import { Salary, SalaryStructure, Bonus } from '../models/salary.model.js';
import { Staff } from '../models/staff.model.js';
import { SalaryCalculation } from '../models/salaryCalculation.model.js';
import { ApiError } from '../utils/responseHandler.js';
import { assertSalaryNotLocked } from './salary.service.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { Office } from '../models/office.model.js';

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

const formatPeriodLabel = (periodMonths) => {
  if (!periodMonths?.length) return '';
  const short = (m, y) => `${MONTH_SHORT[m - 1]}'${String(y).slice(-2)}`;
  if (periodMonths.length === 1) return short(periodMonths[0].month, periodMonths[0].year);
  const first = periodMonths[0];
  const last = periodMonths[periodMonths.length - 1];
  return `${short(first.month, first.year)} - ${short(last.month, last.year)}`;
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

// Auto mode dropdown — each entry now carries a human-readable range label (e.g. "Jan'26 - Aug'26")
export const getBonusSettingMonths = async (officeId) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  if (structure.bonus?.mode !== 'auto') return [];

  return (structure.bonus.rules || [])
    .map((r) => {
      const periodMonths = getPeriodMonths(r.lastMonth, r.lastYear, r.backMonths);
      return {
        month: r.lastMonth,
        year: r.lastYear,
        backMonths: r.backMonths,
        label: formatPeriodLabel(periodMonths),
      };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month);
};

export const calculateAutoBonusForMonth = async (officeId, month, year) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  if (structure.bonus?.mode !== 'auto') {
    throw new ApiError(400, 'Bad Request', 'Bonus mode is not set to "auto" for this office.');
  }

  const rule = (structure.bonus.rules || []).find((r) => r.lastMonth === Number(month) && r.lastYear === Number(year));
  if (!rule) {
    throw new ApiError(400, 'Bad Request', `No bonus rule configured for ${month}/${year}.`);
  }

  const periodMonths = getPeriodMonths(rule.lastMonth, rule.lastYear, rule.backMonths);
  const periodStart = new Date(periodMonths[0].year, periodMonths[0].month - 1, 1);

  const staffList = await Staff.find({
    office: officeId,
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

  const tenurePassedStaffIds = staffList
    .filter((s) => getTenureInMonths(s.dateOfJoining, rule.lastMonth, rule.lastYear) >= rule.minTenureMonths)
    .map((s) => s._id);

  await Bonus.deleteMany({
    office: officeId,
    month: rule.lastMonth,
    year: rule.lastYear,
    mode: 'auto',
    staff: { $nin: tenurePassedStaffIds },
  });
};

// Groups bonus records by department, computes per-department subtotal and grand total.
// Uses staff.staffId (the human-readable code) instead of Mongo _id for display.
const groupByDepartmentWithTotals = async (records) => {
  const staffIds = records.map((r) => r.staff);
  const staffList = await Staff.find({ _id: { $in: staffIds } })
    .select('fullName staffId department')
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
      staffCode: staff.staffId || '-',
      staffName: staff.fullName,
      amount: r.amount,
      baseNetSalarySum: r.baseNetSalarySum,
      monthsCounted: r.monthsCounted,
      percentage: r.percentage,
      remarks: r.remarks || '',
    });
  });

  let grandTotal = 0;
  const departments = Array.from(groups.entries())
    .map(([departmentName, staff]) => {
      const departmentTotal = round2(staff.reduce((sum, s) => sum + (Number(s.amount) || 0), 0));
      grandTotal += departmentTotal;
      return { departmentName, staff, departmentTotal };
    })
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName));

  return { departments, grandTotal: round2(grandTotal) };
};

export const getBonusRegister = async (officeId, month, year) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');

  const lock = await SalaryCalculation.findOne({ office: officeId, month, year }).lean();
  const locked = Boolean(lock?.locked);

  if (structure.bonus?.mode === 'auto') {
    await calculateAutoBonusForMonth(officeId, month, year);
    const rule = (structure.bonus.rules || []).find(
      (r) => r.lastMonth === Number(month) && r.lastYear === Number(year)
    );
    const records = await Bonus.find({ office: officeId, month, year, mode: 'auto' }).lean();
    const { departments, grandTotal } = await groupByDepartmentWithTotals(records);
    const label = rule ? formatPeriodLabel(getPeriodMonths(rule.lastMonth, rule.lastYear, rule.backMonths)) : '';
    return { mode: 'auto', locked, label, departments, grandTotal };
  }

  // Manual mode: register view shows whatever has already been generated & saved for this month/year
  const records = await Bonus.find({ office: officeId, month, year, mode: 'manual' }).lean();
  if (!records.length) {
    return { mode: 'manual', locked, label: '', departments: [], grandTotal: 0 };
  }
  const backMonths = records[0].backMonths || 1;
  const label = formatPeriodLabel(getPeriodMonths(Number(month), Number(year), backMonths));
  const { departments, grandTotal } = await groupByDepartmentWithTotals(records);
  return { mode: 'manual', locked, label, departments, grandTotal };
};

// Manual mode — "Generate Bonus" step: given an end month/year + backMonths (i.e. a date range like
// Jan-Aug) + minTenureMonths, returns eligible staff (joined before/within the range, tenure-qualified),
// department wise, prefilled with any amount already saved for this exact range.
export const getManualBonusRangeStaff = async (officeId, month, year, backMonths, minTenureMonths) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  if (structure.bonus?.mode !== 'manual') {
    throw new ApiError(400, 'Bad Request', 'Bonus mode is not set to "manual" for this office.');
  }
  if (!month || !year || !backMonths || backMonths < 1) {
    throw new ApiError(400, 'Bad Request', 'month, year and backMonths are required.');
  }

  const tenureMin = Number(minTenureMonths) || 0;
  const periodMonths = getPeriodMonths(Number(month), Number(year), Number(backMonths));
  const periodStart = new Date(periodMonths[0].year, periodMonths[0].month - 1, 1);

  const staffList = await Staff.find({
    office: officeId,
    status: 'active',
    dateOfJoining: { $lte: new Date(Number(year), Number(month), 0) },
    $or: [{ dateOfLeaving: null }, { dateOfLeaving: { $exists: false } }, { dateOfLeaving: { $gte: periodStart } }],
  })
    .select('fullName staffId department dateOfJoining')
    .populate('department', 'name')
    .lean();

  const eligibleStaff = staffList.filter(
    (s) => getTenureInMonths(s.dateOfJoining, Number(month), Number(year)) >= tenureMin
  );

  const existing = await Bonus.find({
    office: officeId,
    month: Number(month),
    year: Number(year),
    mode: 'manual',
    backMonths: Number(backMonths),
  }).lean();
  const existingMap = new Map(existing.map((e) => [String(e.staff), e]));

  const groups = new Map();
  eligibleStaff.forEach((staff) => {
    const deptName = staff.department?.name || 'Unassigned';
    if (!groups.has(deptName)) groups.set(deptName, []);
    const entry = existingMap.get(String(staff._id));
    groups.get(deptName).push({
      staffId: staff._id,
      staffCode: staff.staffId || '-',
      staffName: staff.fullName,
      amount: entry?.amount ?? 0,
      remarks: entry?.remarks || '',
    });
  });

  const departments = Array.from(groups.entries())
    .map(([departmentName, staff]) => ({ departmentName, staff }))
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName));

  return { departments, label: formatPeriodLabel(periodMonths) };
};

export const saveManualBonusEntries = async (officeId, month, year, backMonths, minTenureMonths, entries) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  if (structure.bonus?.mode !== 'manual') {
    throw new ApiError(400, 'Bad Request', 'Bonus mode is not set to "manual" for this office.');
  }
  if (!Array.isArray(entries) || !entries.length) {
    throw new ApiError(400, 'Bad Request', 'entries array is required.');
  }
  if (!backMonths || backMonths < 1) {
    throw new ApiError(400, 'Bad Request', 'backMonths (derived from the selected date range) is required.');
  }

  await assertSalaryNotLocked(officeId, month, year);

  const results = [];
  for (const entry of entries) {
    if (!entry.staffId) continue;
    const amount = Number(entry.amount) || 0;
    const updated = await Bonus.findOneAndUpdate(
      { office: officeId, staff: entry.staffId, month, year },
      {
        mode: 'manual',
        amount,
        backMonths: Number(backMonths),
        minTenureMonths: Number(minTenureMonths) || 0,
        remarks: entry.remarks || '',
      },
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

// Shared data builder for PDF/Excel — department grouped, with subtotal + grand total + range label.
const buildBonusRegisterData = async (officeId, month, year) => {
  const structure = await SalaryStructure.findOne({ office: officeId }).lean();
  if (!structure) throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');

  if (structure.bonus?.mode === 'auto') {
    await calculateAutoBonusForMonth(officeId, month, year);
  }

  const records = await Bonus.find({ office: officeId, month, year, mode: structure.bonus?.mode }).lean();
  const filteredRecords = structure.bonus?.mode === 'auto' ? records.filter((r) => r.amount > 0) : records;

  if (!filteredRecords.length) {
    throw new ApiError(404, 'Not Found!', 'No bonus records found for the given month.');
  }

  const { departments, grandTotal } = await groupByDepartmentWithTotals(filteredRecords);

  let label = '';
  if (structure.bonus?.mode === 'auto') {
    const rule = (structure.bonus.rules || []).find(
      (r) => r.lastMonth === Number(month) && r.lastYear === Number(year)
    );
    if (rule) label = formatPeriodLabel(getPeriodMonths(rule.lastMonth, rule.lastYear, rule.backMonths));
  } else {
    const backMonths = filteredRecords[0].backMonths || 1;
    label = formatPeriodLabel(getPeriodMonths(Number(month), Number(year), backMonths));
  }

  const office = await Office.findById(officeId).select('name').lean();

  return { departments, grandTotal, label, officeName: office?.name || '' };
};

export const generateBonusRegisterPdf = async (officeId, month, year) => {
  const { departments, grandTotal, label, officeName } = await buildBonusRegisterData(officeId, month, year);

  const doc = new jsPDF({ format: 'a4', orientation: 'p' });
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;

  const NAVY = [30, 41, 59];
  const BLUE = [46, 134, 171];
  const LIGHT_BLUE = [219, 234, 254];
  const BORDER = [214, 221, 229];

  const drawLetterhead = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageWidth, 24, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    doc.text(officeName?.toUpperCase() || 'COMPANY NAME', marginX, 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(210, 220, 230);
    doc.text('Bonus Register', marginX, 18);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const periodText = `PERIOD: ${label}`;
    const periodWidth = doc.getTextWidth(periodText) + 8;
    doc.setFillColor(...BLUE);
    doc.roundedRect(pageWidth - marginX - periodWidth, 7, periodWidth, 9, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(periodText, pageWidth - marginX - periodWidth / 2, 13, { align: 'center' });

    doc.setTextColor(0, 0, 0);
  };

  const drawDeptBanner = (deptName, y) => {
    doc.setFillColor(...LIGHT_BLUE);
    doc.setDrawColor(...BLUE);
    doc.setLineWidth(0.3);
    doc.roundedRect(marginX, y, contentWidth, 9, 1, 1, 'FD');
    doc.setFillColor(...BLUE);
    doc.rect(marginX, y, 2.5, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...NAVY);
    doc.text(deptName.toUpperCase(), marginX + 6, y + 6);
    doc.setTextColor(0, 0, 0);
  };

  const drawFooter = () => {
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.2);
    doc.line(marginX, pageHeight - 14, pageWidth - marginX, pageHeight - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    const generatedDate = `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
    doc.text(generatedDate, marginX, pageHeight - 9);
    const pageLabel = `Page ${doc.internal.getNumberOfPages()}`;
    const pw = doc.getTextWidth(pageLabel);
    doc.text(pageLabel, pageWidth - marginX - pw, pageHeight - 9);
    doc.setTextColor(0, 0, 0);
  };

  // Fixed column widths — SL/ID/AMOUNT/SIGNATURE take a fixed share,
  // NAME absorbs the rest, so nothing ever gets clipped.
  const colSL = 10;
  const colStaffId = 24;
  const colAmount = 28;
  const colSignature = 32;
  const colName = contentWidth - colSL - colStaffId - colAmount - colSignature;

  const columnStyles = {
    0: { cellWidth: colSL, halign: 'center' },
    1: { cellWidth: colStaffId, halign: 'center' },
    2: { cellWidth: colName, halign: 'left', overflow: 'linebreak' },
    3: { cellWidth: colAmount, halign: 'right' },
    4: { cellWidth: colSignature, halign: 'center' },
  };

  // One department = one page. If a department's staff list overflows the page,
  // autoTable adds a continuation page and didDrawPage re-draws the letterhead/banner on it.
  departments.forEach((dept, deptIndex) => {
    if (deptIndex > 0) doc.addPage();

    drawLetterhead();
    drawDeptBanner(dept.departmentName, 30);

    const body = dept.staff.map((s, i) => [i + 1, s.staffCode, s.staffName, safeToFixed(s.amount), '']);
    const startPage = doc.internal.getNumberOfPages();

    autoTable(doc, {
      startY: 43,
      margin: { left: marginX, right: marginX, bottom: 20 },
      head: [['SL', 'STAFF ID', 'NAME', 'AMOUNT', 'SIGNATURE']],
      body,
      foot: [
        [
          { content: 'DEPARTMENT TOTAL', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } },
          { content: safeToFixed(dept.departmentTotal), styles: { fontStyle: 'bold' } },
          '',
        ],
      ],
      showFoot: 'lastPage',
      theme: 'grid',
      styles: {
        fontSize: 9,
        cellPadding: 2.5,
        valign: 'middle',
        overflow: 'linebreak',
        lineColor: BORDER,
        lineWidth: 0.15,
      },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 9, halign: 'center' },
      footStyles: { fillColor: [235, 242, 250], textColor: NAVY, fontSize: 9.5 },
      alternateRowStyles: { fillColor: [245, 248, 252] },
      columnStyles,
      showHead: 'everyPage',
      rowPageBreak: 'avoid', // a staff row never splits across two pages
      didDrawPage: (data) => {
        if (data.pageNumber > startPage) {
          drawLetterhead();
          drawDeptBanner(`${dept.departmentName} (contd.)`, 30);
          data.settings.margin.top = 43;
        }
      },
    });
  });

  // ---------- Summary page ----------
  doc.addPage();
  drawLetterhead();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...NAVY);
  doc.text('SUMMARY', marginX, 34);
  doc.setTextColor(0, 0, 0);

  const summaryBody = departments.map((d) => [d.departmentName, safeToFixed(d.departmentTotal)]);

  autoTable(doc, {
    startY: 40,
    margin: { left: marginX, right: marginX },
    head: [['Department', 'Total Amount']],
    body: summaryBody,
    foot: [
      [
        { content: 'GRAND TOTAL', styles: { fontStyle: 'bold' } },
        { content: safeToFixed(grandTotal), styles: { fontStyle: 'bold' } },
      ],
    ],
    theme: 'plain',
    styles: {
      fontSize: 9.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
      lineColor: BORDER,
      lineWidth: 0.15,
      overflow: 'linebreak',
    },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: BLUE, textColor: [255, 255, 255], fontSize: 10.5 },
    alternateRowStyles: { fillColor: [237, 242, 247] },
    columnStyles: { 0: { halign: 'left' }, 1: { halign: 'right' } },
  });

  // ---------- Footer on every page (single pass at the end) ----------
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter();
  }

  return doc.output('arraybuffer');
};

export const generateBonusRegisterWithoutSigPdf = async (officeId, month, year) => {
  const { departments, grandTotal, label, officeName } = await buildBonusRegisterData(officeId, month, year);

  const doc = new jsPDF({ format: 'a4', orientation: 'p' });
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const marginX = 10;
  const contentWidth = pageWidth - marginX * 2;

  const NAVY = [30, 41, 59];
  const BLUE = [46, 134, 171];
  const LIGHT_BLUE = [219, 234, 254];
  const BORDER = [214, 221, 229];

  // ---------- Header banner (once, page 1) ----------
  const headerHeight = 26;
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, headerHeight, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(officeName?.toUpperCase() || 'COMPANY NAME', marginX, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 210, 225);
  doc.text('Bonus Register', marginX, 19);

  const periodText = `PERIOD: ${label}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const periodTextWidth = doc.getTextWidth(periodText);
  const badgeWidth = periodTextWidth + 10;
  const badgeHeight = 9;
  const badgeX = pageWidth - marginX - badgeWidth;
  const badgeY = 8;
  doc.setFillColor(...BLUE);
  doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(periodText, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2 + 1.2, { align: 'center' });

  doc.setTextColor(0, 0, 0);

  let cursorY = headerHeight + 10;

  // Fixed column widths (mm) — NAME/AMOUNT never squeezed or clipped.
  const colSL = 12;
  const colStaffId = 28;
  const colAmount = 34;
  const colName = contentWidth - colSL - colStaffId - colAmount;

  const columnStyles = {
    0: { cellWidth: colSL, halign: 'center' },
    1: { cellWidth: colStaffId, halign: 'center' },
    2: { cellWidth: colName, halign: 'left', overflow: 'linebreak' },
    3: { cellWidth: colAmount, halign: 'right' },
  };

  // Continuous flow — no forced page-per-department. A department only moves
  // to a new page if its banner genuinely doesn't fit; the table body itself
  // paginates naturally via autoTable.
  departments.forEach((dept) => {
    if (cursorY > pageHeight - 40) {
      doc.addPage();
      cursorY = 15;
    }

    doc.setFillColor(...LIGHT_BLUE);
    doc.rect(marginX, cursorY, contentWidth, 8, 'F');
    doc.setFillColor(...BLUE);
    doc.rect(marginX, cursorY, 1.5, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text(dept.departmentName.toUpperCase(), marginX + 5, cursorY + 5.5);
    doc.setTextColor(0, 0, 0);
    cursorY += 8;

    const body = dept.staff.map((s, i) => [i + 1, s.staffCode, s.staffName, safeToFixed(s.amount)]);
    const totalRowIndex = body.length;
    body.push([
      { content: 'DEPARTMENT TOTAL', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right' } },
      { content: safeToFixed(dept.departmentTotal), styles: { fontStyle: 'bold' } },
    ]);

    autoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX, bottom: 16 },
      head: [['SL', 'STAFF ID', 'NAME', 'AMOUNT']],
      body,
      theme: 'grid',
      styles: {
        fontSize: 9,
        cellPadding: 2.5,
        valign: 'middle',
        overflow: 'linebreak',
        lineColor: BORDER,
        lineWidth: 0.15,
      },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 9, halign: 'center' },
      alternateRowStyles: { fillColor: [245, 248, 252] },
      columnStyles,
      rowPageBreak: 'avoid', // a staff row never splits across two pages
      didParseCell: (data) => {
        if (data.row.index === totalRowIndex) {
          data.cell.styles.fillColor = [235, 242, 250];
        }
      },
    });

    cursorY = doc.lastAutoTable.finalY + 8;
  });

  // ---------- Grand total bar ----------
  if (cursorY > pageHeight - 25) {
    doc.addPage();
    cursorY = 15;
  }
  doc.setFillColor(...BLUE);
  doc.roundedRect(marginX, cursorY, contentWidth, 12, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text('GRAND TOTAL', marginX + 5, cursorY + 8);
  doc.text(safeToFixed(grandTotal), pageWidth - marginX - 5, cursorY + 8, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  // ---------- Footer on every page ----------
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    const generatedDate = `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
    doc.text(generatedDate, marginX, pageHeight - 8);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 8, { align: 'right' });
  }

  return doc.output('arraybuffer');
};

export const generateBonusRegisterExcel = async (officeId, month, year) => {
  const { departments, grandTotal, label, officeName } = await buildBonusRegisterData(officeId, month, year);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Bonus Register');
  const colCount = 5;
  const colWidths = [6, 14, 26, 14, 20];
  colWidths.forEach((w, idx) => {
    sheet.getColumn(idx + 1).width = w;
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
  subtitleCell.value = `BONUS REGISTER (${label})`;
  subtitleCell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
  sheet.getRow(2).height = 16;

  let rowIndex = 3;
  const headers = ['SL', 'STAFF ID', 'NAME', 'AMOUNT', 'SIGNATURE'];

  departments.forEach((dept) => {
    sheet.mergeCells(rowIndex, 1, rowIndex, colCount);
    const deptCell = sheet.getCell(rowIndex, 1);
    deptCell.value = dept.departmentName.toUpperCase();
    deptCell.font = { bold: true, size: 10 };
    deptCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6E6' } };
    deptCell.border = thinBorder;
    sheet.getRow(rowIndex).height = 18;
    rowIndex++;

    const headerRow = sheet.getRow(rowIndex);
    headers.forEach((h, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = h;
      cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
      cell.border = thinBorder;
    });
    headerRow.height = 20;
    rowIndex++;

    const firstStaffRow = rowIndex;
    dept.staff.forEach((s, i) => {
      const row = sheet.getRow(rowIndex);
      const rowData = [i + 1, s.staffCode, s.staffName, round2(s.amount), ''];
      rowData.forEach((val, idx) => {
        const cell = row.getCell(idx + 1);
        cell.value = val;
        cell.font = { size: 9 };
        cell.border = thinBorder;
        cell.alignment = { horizontal: idx === 2 ? 'left' : 'center' };
      });
      row.height = 20;
      rowIndex++;
    });
    const lastStaffRow = rowIndex - 1;

    sheet.mergeCells(rowIndex, 1, rowIndex, 3);
    const totalLabelCell = sheet.getCell(rowIndex, 1);
    totalLabelCell.value = 'Department Total';
    totalLabelCell.font = { bold: true, size: 9 };
    totalLabelCell.alignment = { horizontal: 'right' };
    totalLabelCell.border = thinBorder;

    const totalAmountCell = sheet.getCell(rowIndex, 4);
    totalAmountCell.value = { formula: `SUM(D${firstStaffRow}:D${lastStaffRow})` };
    totalAmountCell.font = { bold: true, size: 9 };
    totalAmountCell.alignment = { horizontal: 'center' };
    totalAmountCell.border = thinBorder;

    sheet.getCell(rowIndex, 5).border = thinBorder;
    sheet.getRow(rowIndex).height = 18;
    rowIndex++;
  });

  sheet.mergeCells(rowIndex, 1, rowIndex, 3);
  const grandLabelCell = sheet.getCell(rowIndex, 1);
  grandLabelCell.value = 'GRAND TOTAL';
  grandLabelCell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  grandLabelCell.alignment = { horizontal: 'right', vertical: 'middle' };
  grandLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
  grandLabelCell.border = thinBorder;

  const grandAmountCell = sheet.getCell(rowIndex, 4);
  grandAmountCell.value = round2(grandTotal);
  grandAmountCell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  grandAmountCell.alignment = { horizontal: 'center' };
  grandAmountCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
  grandAmountCell.border = thinBorder;

  const grandSigCell = sheet.getCell(rowIndex, 5);
  grandSigCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
  grandSigCell.border = thinBorder;
  sheet.getRow(rowIndex).height = 20;

  return workbook.xlsx.writeBuffer();
};
