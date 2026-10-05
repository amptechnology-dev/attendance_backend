import { Attendance } from '../models/attendance.model.js';
import { Salary, SalaryStructure, AdvanceTransaction } from '../models/salary.model.js';
import { jsPDF } from 'jspdf';
import ExcelJS from 'exceljs';
import autoTable from 'jspdf-autotable';
import { format, startOfYear, endOfYear } from 'date-fns';
import { writeToString } from 'fast-csv';
import { Leave } from '../models/leave.model.js';
import { Office } from '../models/office.model.js';
import { Staff } from '../models/staff.model.js';
import { HolidayFund } from '../models/holidayFund.model.js';
import voca from 'voca';

function minutesToHM(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  return `${hours}h ${minutes}m`;
}

export const generateStaffReport = async (filters) => {
  const { office, status, sortBy = 'name', sortOrder = 'asc', limit = 20, page = 1 } = filters;
};

export const generateAttendanceReport = async (filters) => {
  const {
    office,
    staffId,
    startDate,
    endDate,
    date,
    status,
    isLate,
    sortBy = 'date',
    sortOrder = 'asc',
    limit,
    page = 1,
    workingTimeMin,
    workingTimeMax,
  } = filters;

  try {
    let filter = { office };

    // staff filter
    if (staffId) {
      filter.staffId = staffId;
    }

    // date filter
    let dateFilter = {};

    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    if (date) {
      filter.date = new Date(date);
    } else if (Object.keys(dateFilter).length) {
      filter.date = dateFilter;
    }

    // working time filter
    if (workingTimeMin || workingTimeMax) {
      filter.working_time = {};
      if (workingTimeMin) filter.working_time.$gte = Number(workingTimeMin);
      if (workingTimeMax) filter.working_time.$lte = Number(workingTimeMax);
    }

    // status filter
    if (status) {
      filter.status = status;
    }

    // late filter
    if (isLate !== undefined) {
      filter.isLate = isLate;
    }

    // sorting
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // base query
    let query = Attendance.find(filter).select('-__v -logs -office').populate('staffId', 'staffId fullName').sort(sort);

    // apply pagination ONLY if limit provided
    if (limit) {
      const skip = (page - 1) * Number(limit);
      query = query.skip(skip).limit(Number(limit));
    }

    const report = await query;

    const totalRecords = await Attendance.countDocuments(filter);

    return {
      report,
      pagination: limit
        ? {
            totalRecords,
            totalPages: Math.ceil(totalRecords / limit),
            currentPage: Number(page),
            limit: Number(limit),
          }
        : null,
    };
  } catch (error) {
    throw error;
  }
};

export const generateAttendancePDF = async (officeName, data, filters) => {
  var doc = new jsPDF({ format: 'a4' });
  // Get the page height and width
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const totalPagesExp = '{total_pages_count_string}';

  const drawHeaderFooter = () => {
    // Title
    doc.setFontSize(22);
    doc.setFont('times', 'bold');
    doc.setTextColor('#1ABD9C');
    doc.text('ATTENDANCE REPORT', pageWidth / 2, 15, { align: 'center' });

    // Subtitle
    doc.setFontSize(14);
    doc.setTextColor('black');
    doc.text(officeName, pageWidth / 2, 22, { align: 'center' });
    doc.setLineWidth(0.2);
    doc.line(10, 27, pageWidth - 10, 27);

    // Filters applied
    doc.setFontSize(12);
    autoTable(doc, {
      startY: 30,
      body: [
        [`From: ${filters.startDate || '-'}`, `To: ${filters.endDate || '-'}`, `Date: ${filters.date || '-'}`],
        [
          `Staff: ${filters.staffId ? `${data[0]?.staffId?.staffId} - ${data[0]?.staffId?.fullName}` : 'All'}`,
          `Status: ${filters.status || 'All'}`,
          `Sort By: ${filters.sortBy || 'Date'}`,
        ],
      ],
      theme: 'grid',
      bodyStyles: { fontStyle: 'bold' },
    });

    // FOOTER
    const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFontSize(10);
    doc.setTextColor('gray');
    doc.text(`Page ${currentPage} of ${totalPagesExp}`, pageWidth - 40, pageHeight - 10);
    doc.text(`Generated: ${format(new Date(), 'dd-MM-yyyy hh:mmaa')}`, 10, pageHeight - 10);
  };

  // Table headers
  const headers = [['Date', 'Staff ID', 'Staff Name', 'Working Time', 'Break Time', 'Status', 'HR Adjustments']];

  // Table rows
  const rows = data?.map((row) => [
    format(row.date, 'dd-MM-yyyy'),
    row.staffId?.staffId,
    row.staffId?.fullName,
    minutesToHM(row.totalWorkTime),
    minutesToHM(row.breakTime),
    row.status,
    row.hrAdjustments?.adjustments,
  ]);

  // Add table to the document
  autoTable(doc, {
    margin: { top: 50 },
    head: headers,
    body: rows,
    theme: 'grid',
    didDrawPage: drawHeaderFooter,
  });

  if (typeof doc.putTotalPages === 'function') {
    doc.putTotalPages(totalPagesExp);
  }

  // Return the PDF buffer
  return doc.output('arraybuffer');
};

export const generateAttendanceCsv = async (data) => {
  // headers
  const headers = ['Date', 'Staff ID', 'Staff Name', 'First Half', 'Second Half', 'Status', 'HR Adjustments'];
  // rows
  const rows = data?.map((row) => [
    format(row.date, 'dd-MM-yyyy'),
    row.staffId?.staffId,
    row.staffId?.fullName,
    row.firstHalf,
    row.secondHalf,
    row.status,
    row.hrAdjustments?.adjustments,
  ]);
  // Generate CSV string
  const csvString = await writeToString(rows, { headers });
  return csvString;
};

export const generateMonthlyAttendanceReport = async (filters) => {
  const { office, month, startDate, endDate, staff, department } = filters;
  const matchStage = { office };

  let fromDate = startDate ? new Date(startDate) : null;
  let toDate = endDate ? new Date(endDate) : null;

  if (month) {
    const [year, monthNumber] = month.split('-').map(Number);
    fromDate = new Date(year, monthNumber - 1, 1);
    toDate = new Date(year, monthNumber, 0, 23, 59, 59, 999);
  }

  if (fromDate && toDate) {
    matchStage.date = {
      $gte: fromDate,
      $lte: toDate,
    };
  }

  if (staff) {
    matchStage.staffId = staff;
  }

  return Attendance.aggregate([
    { $match: matchStage },

    {
      $lookup: {
        from: 'staffs',
        localField: 'staffId',
        foreignField: '_id',
        as: 'staff',
      },
    },
    { $unwind: '$staff' },

    ...(department
      ? [
          {
            $match: {
              'staff.department': department,
            },
          },
        ]
      : []),

    {
      $lookup: {
        from: 'departments',
        localField: 'staff.department',
        foreignField: '_id',
        as: 'department',
      },
    },
    { $unwind: '$department' },

    {
      $lookup: {
        from: 'entryexitlogs',
        localField: 'logs',
        foreignField: '_id',
        as: 'logs',
      },
    },

    {
      $addFields: {
        entryTime: { $min: '$logs.entryTime' },
        exitTime: { $max: '$logs.exitTime' },
      },
    },

    {
      $group: {
        _id: {
          staff: '$staff._id',
          department: '$department._id',
        },

        staffId: { $first: '$staff.staffId' },
        pfNo: { $first: '$staff.pfNo' }, // <-- Added
        staffName: { $first: '$staff.fullName' },
        departmentName: { $first: '$department.name' },

        fullDays: {
          $sum: {
            $cond: [{ $eq: ['$status', 'full-day'] }, 1, 0],
          },
        },

        halfDays: {
          $sum: {
            $cond: [{ $eq: ['$status', 'half-day'] }, 1, 0],
          },
        },

        presents: {
          $sum: {
            $cond: [{ $eq: ['$status', 'present'] }, 1, 0],
          },
        },

        absents: {
          $sum: {
            $cond: [{ $eq: ['$status', 'absent'] }, 1, 0],
          },
        },

        hrAdjustments: {
          $sum: {
            $cond: [{ $ne: ['$hrAdjustments.adjustments', 'None'] }, 1, 0],
          },
        },

        attendances: {
          $push: {
            _id: '$_id',
            date: '$date',
            entryTime: '$entryTime',
            exitTime: '$exitTime',
            status: '$status',
            hrAdjustment: '$hrAdjustments.adjustments',
          },
        },
      },
    },

    {
      $match: {
        attendances: { $ne: [] },
      },
    },

    {
      $sort: {
        staffName: 1,
      },
    },

    {
      $group: {
        _id: '$_id.department',

        departmentName: {
          $first: '$departmentName',
        },

        staffReports: {
          $push: {
            staff: '$_id.staff',
            staffId: '$staffId',
            pfNo: '$pfNo', // <-- Added
            staffName: '$staffName',
            fullDays: '$fullDays',
            halfDays: '$halfDays',
            presents: '$presents',
            absents: '$absents',
            hrAdjustments: '$hrAdjustments',
            attendances: '$attendances',
          },
        },
      },
    },

    {
      $sort: {
        departmentName: 1,
      },
    },
  ]);
};

export const generateYearlyAttendanceReport = async (filters) => {
  const { office, year } = filters;
  const startDate = startOfYear(new Date(year, 0, 1));
  const endDate = endOfYear(new Date(year, 11, 31));

  const result = await Attendance.aggregate([
    { $match: { date: { $gte: startDate, $lte: endDate }, office } },
    {
      $group: {
        _id: { staff: '$staffId', month: { $month: '$date' }, status: '$status' },
        count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'staffs',
        localField: '_id.staff',
        foreignField: '_id',
        as: 'staff',
      },
    },
    { $unwind: '$staff' },
    {
      $lookup: {
        from: 'departments',
        localField: 'staff.department',
        foreignField: '_id',
        as: 'department',
      },
    },
    { $unwind: '$department' },
    {
      $sort: {
        'department.name': 1,
      },
    },
  ]);

  const departments = {};
  result.forEach((r) => {
    const staff = r._id.staff.toString();
    const staffId = r.staff.staffId;
    const month = r._id.month;
    const status = r._id.status;
    const count = r.count;
    const name = r.staff.fullName;
    const departmentName = r.department.name;

    if (!departments[departmentName]) {
      departments[departmentName] = {
        departmentName,
        employees: {},
      };
    }

    if (!departments[departmentName].employees[staff]) {
      departments[departmentName].employees[staff] = {
        staffId,
        name,
        monthly: Array.from({ length: 12 }, () => ({ fd: 0, hd: 0, a: 0, h: 0 })),
      };
    }

    const m = departments[departmentName].employees[staff].monthly[month - 1];
    if (status === 'full-day') m.fd += count;
    if (status === 'half-day') m.hd += count;
    if (status === 'absent') m.a += count;
    if (status === 'holiday') m.h += count;
  });
  const grouped = Object.values(departments).map((dept) => ({
    departmentName: dept.departmentName,
    employees: Object.values(dept.employees).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const doc = new jsPDF({ orientation: 'landscape', format: 'A3' });
  // Months
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // First header row
  const topHeader = [
    { content: 'Staff', rowSpan: 2 },
    ...months.map((m) => ({ content: m, colSpan: 3, styles: { halign: 'center' } })),
    { content: 'Totals', colSpan: 3, styles: { halign: 'center' } },
  ];

  // Second header row
  const subHeader = [...months.flatMap(() => ['FD', 'HD', 'A']), 'FD', 'HD', 'A'];
  const officeData = await Office.findOne({ _id: office }).select('name');
  const officeName = officeData?.name || '';

  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const totalPagesExp = '{total_pages_count_string}';

  const drawHeaderFooter = () => {
    // Title
    doc.setFontSize(22);
    doc.setFont('times', 'bold');
    doc.setTextColor('#1ABD9C');
    doc.text('YEARLY ATTENDANCE REPORT', pageWidth / 2, 15, { align: 'center' });

    // Subtitle
    doc.setFontSize(14);
    doc.setTextColor('black');
    doc.text(officeName, pageWidth / 2, 22, { align: 'center' });
    doc.setLineWidth(0.2);
    doc.line(10, 27, pageWidth - 10, 27);

    // FOOTER
    const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFontSize(10);
    doc.setTextColor('gray');
    doc.text(`Page ${currentPage} of ${totalPagesExp}`, pageWidth - 40, pageHeight - 10);
    doc.text(`Generated: ${format(new Date(), 'dd-MM-yyyy hh:mmaa')}`, 10, pageHeight - 10);
  };

  grouped.forEach((dept, i) => {
    // Add a new page for every department except the first
    if (i !== 0) doc.addPage();

    const body = dept.employees.map((emp) => {
      const monthlyVals = emp.monthly.flatMap((m) => [m.fd, m.hd, m.a]);

      const totalFd = emp.monthly.reduce((s, m) => s + m.fd, 0);
      const totalHd = emp.monthly.reduce((s, m) => s + m.hd, 0);
      const totalA = emp.monthly.reduce((s, m) => s + m.a, 0);

      return [emp.name, ...monthlyVals, totalFd, totalHd, totalA];
    });

    doc.text(`Department: ${dept.departmentName}`, 10, 45);

    // Generate table
    autoTable(doc, {
      head: [topHeader, subHeader],
      body,
      margin: { top: 50, left: 10, right: 10, bottom: 10 },
      theme: 'grid',
      columnStyles: {
        0: { halign: 'left' },
      },
      didDrawPage: drawHeaderFooter,
    });
  });

  if (typeof doc.putTotalPages === 'function') {
    doc.putTotalPages(totalPagesExp);
  }

  return doc.output('arraybuffer');
};

export const generateSalaryReport = async (filters) => {
  const { startMonth, endMonth, month, office, staff, status, sortBy, sortOrder = 'asc', limit, page = 1 } = filters;

  try {
    let filter = { office };

    // exact month filter
    if (month) {
      const [year, monthNumber] = month.split('-').map(Number);
      filter.year = year;
      filter.month = monthNumber;
    }

    // month range filter
    else if (startMonth || endMonth) {
      const rangeQuery = [];

      if (startMonth) {
        const [startYear, startMonthNumber] = startMonth.split('-').map(Number);

        rangeQuery.push({
          $or: [{ year: { $gt: startYear } }, { year: startYear, month: { $gte: startMonthNumber } }],
        });
      }

      if (endMonth) {
        const [endYear, endMonthNumber] = endMonth.split('-').map(Number);

        rangeQuery.push({
          $or: [{ year: { $lt: endYear } }, { year: endYear, month: { $lte: endMonthNumber } }],
        });
      }

      if (rangeQuery.length === 2) {
        filter.$and = rangeQuery;
      } else if (rangeQuery.length === 1) {
        Object.assign(filter, rangeQuery[0]);
      }
    }

    // staff filter
    if (staff) filter.staff = staff;

    // status filter
    if (status) filter.status = status;

    // sorting
    const sort = sortBy
      ? { [sortBy]: sortOrder === 'desc' ? -1 : 1 }
      : {
          year: sortOrder === 'desc' ? -1 : 1,
          month: sortOrder === 'desc' ? -1 : 1,
        };

    // base query
    let query = Salary.find(filter).select('-__v -office -breakdown').populate('staff', 'staffId fullName').sort(sort);

    // apply pagination ONLY if limit provided
    if (limit) {
      const skip = (page - 1) * Number(limit);
      query = query.skip(skip).limit(Number(limit));
    }

    const report = await query;

    const totalRecords = await Salary.countDocuments(filter);

    return {
      report,
      pagination: limit
        ? {
            totalRecords,
            totalPages: Math.ceil(totalRecords / limit),
            currentPage: Number(page),
            limit: Number(limit),
          }
        : null,
    };
  } catch (error) {
    throw error;
  }
};

export const generateSalaryPDF = async (officeName, data, filters) => {
  var doc = new jsPDF({ format: 'a4' });
  // Get the page height and width
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const totalPagesExp = '{total_pages_count_string}';

  const drawHeaderFooter = () => {
    // Title
    doc.setFontSize(22);
    doc.setFont('times', 'bold');
    doc.setTextColor('#1ABD9C');
    doc.text('SALARY REPORT', pageWidth / 2, 15, { align: 'center' });

    // Subtitle
    doc.setFontSize(14);
    doc.setTextColor('black');
    doc.text(officeName, pageWidth / 2, 22, { align: 'center' });
    doc.setLineWidth(0.2);
    doc.line(10, 27, pageWidth - 10, 27);

    // Filters applied
    doc.setFontSize(12);
    autoTable(doc, {
      startY: 30,
      body: [
        [
          `From Month: ${filters.startMonth && !filters.month ? filters.startMonth : '-'}`,
          `To Month: ${filters.endMonth && !filters.month ? filters.endMonth : '-'}`,
          `Month: ${filters.month ? filters.month : '-'}`,
        ],
        [
          `Staff: ${filters.staff ? `${data[0]?.staff?.staffId} - ${data[0]?.staff?.fullName}` : 'All'}`,
          `Sort By: ${filters.sortBy || 'Month-Year'}`,
        ],
      ],
      theme: 'grid',
      bodyStyles: { fontStyle: 'bold' },
    });

    // FOOTER
    const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFontSize(10);
    doc.setTextColor('gray');
    doc.text(`Page ${currentPage} of ${totalPagesExp}`, pageWidth - 40, pageHeight - 10);
    doc.text(`Generated: ${format(new Date(), 'dd-MM-yyyy hh:mmaa')}`, 10, pageHeight - 10);
  };

  // Table headers
  const headers = [
    ['Month', 'Staff ID', 'Staff Name', 'Base Salary', 'Gross Salary', 'Other Deductions', 'Net Salary'],
  ];

  // Table rows
  const rows = data?.map((row) => [
    format(new Date(row.year, row.month - 1), 'MMM - yyyy'),
    row.staff?.staffId,
    row.staff?.fullName,
    row.baseSalary.toFixed(2),
    row.grossSalary.toFixed(2),
    row.deductions.toFixed(2),
    row.netSalary.toFixed(2),
  ]);

  // Add table to the document
  autoTable(doc, {
    margin: { top: 50, bottom: 15 },
    head: headers,
    body: rows,
    theme: 'grid',
    didDrawPage: drawHeaderFooter,
  });

  if (typeof doc.putTotalPages === 'function') {
    doc.putTotalPages(totalPagesExp);
  }

  // Return the PDF buffer
  return doc.output('arraybuffer');
};

export const generateSalaryCsv = async (data) => {
  // headers
  const headers = ['Month', 'Staff ID', 'Staff Name', 'Gross Salary', 'Net Salary'];

  //  rows
  const rows = data?.map((row) => [
    format(new Date(row.year, row.month - 1), 'MMM - yyyy'),
    row.staff?.staffId,
    row.staff?.fullName,
    row.grossSalary.toFixed(2),
    row.netSalary.toFixed(2),
  ]);

  // Generate CSV string
  const csvString = await writeToString(rows, { headers });
  return csvString;
};

export const generateLeavesReport = async (filters) => {
  const {
    startDate,
    endDate,
    date,
    office,
    staff,
    type,
    status,
    sortBy = 'dateFrom',
    sortOrder = 'asc',
    limit,
    page = 1,
  } = filters;

  try {
    let filter = {
      office,
      ...(staff && { staff }),
      ...(type && { type }),
      ...(status && { status }),
    };

    // Date filtering
    let dateFilter = {};

    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    if (date) {
      filter.dateFrom = new Date(date);
    } else if (Object.keys(dateFilter).length) {
      filter.dateFrom = dateFilter;
    }

    // Sorting
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Base query
    let query = Leave.find(filter).select('-__v -office -document').populate('staff', 'staffId fullName').sort(sort);

    // Apply pagination only if limit exists
    if (limit) {
      const skip = (page - 1) * Number(limit);
      query = query.skip(skip).limit(Number(limit));
    }

    const report = await query;

    const totalRecords = await Leave.countDocuments(filter);

    return {
      report,
      pagination: limit
        ? {
            totalRecords,
            totalPages: Math.ceil(totalRecords / limit),
            currentPage: Number(page),
            limit: Number(limit),
          }
        : null,
    };
  } catch (error) {
    throw error;
  }
};

export const generateLeavesPDF = async (officeName, data, filters) => {
  var doc = new jsPDF({ format: 'a4' });
  // Get the page height and width
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const totalPagesExp = '{total_pages_count_string}';

  const drawHeaderFooter = () => {
    // Title
    doc.setFontSize(22);
    doc.setFont('times', 'bold');
    doc.setTextColor('#1ABD9C');
    doc.text('LEAVES REPORT', pageWidth / 2, 15, { align: 'center' });

    // Subtitle
    doc.setFontSize(14);
    doc.setTextColor('black');
    doc.text(officeName, pageWidth / 2, 22, { align: 'center' });
    doc.setLineWidth(0.2);
    doc.line(10, 27, pageWidth - 10, 27);

    // Filters applied
    doc.setFontSize(12);
    autoTable(doc, {
      startY: 30,
      body: [
        [`From: ${filters.startDate || '-'}`, `To: ${filters.endDate || '-'}`, `Date: ${filters.date || '-'}`],
        [
          `Staff: ${filters.staff ? `${data[0]?.staff?.staffId} - ${data[0]?.staff?.fullName}` : 'All'}`,
          `Type: ${filters.type || 'All'}`,
          `Status: ${filters.status || 'All'}`,
          `Sort By: ${filters.sortBy || 'Date'}`,
        ],
      ],
      theme: 'grid',
      bodyStyles: { fontStyle: 'bold' },
    });

    // FOOTER
    const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFontSize(10);
    doc.setTextColor('gray');
    doc.text(`Page ${currentPage} of ${totalPagesExp}`, pageWidth - 40, pageHeight - 10);
    doc.text(`Generated: ${format(new Date(), 'dd-MM-yyyy hh:mmaa')}`, 10, pageHeight - 10);
  };

  // Table headers
  const headers = [['Date', 'Staff ID', 'Staff Name', 'Type', 'Reason', 'Date Applied', 'Status']];
  // Table rows
  const getLeaveType = (type) => {
    switch (type) {
      case 'sick':
        return 'Sick Leave';
      case 'casual':
        return 'Casual Leave';
      case 'holidayLeave':
        return 'Holiday Leave';
      default:
        return type;
    }
  };

  const rows = data?.map((row) => [
    format(row.dateFrom, 'dd-MM-yyyy') +
      (row.dateTo && row.dateFrom.getTime() !== row.dateTo.getTime() ? ` to ${format(row.dateTo, 'dd-MM-yyyy')}` : ''),
    row.staff?.staffId,
    row.staff?.fullName,
    getLeaveType(row.type),
    row.reason,
    format(row.createdAt, 'dd-MM-yyyy'),
    row.status,
  ]);

  // Add table to the document
  autoTable(doc, {
    margin: { top: 50, bottom: 15 },
    head: headers,
    body: rows,
    theme: 'grid',
    didDrawPage: drawHeaderFooter,
  });
  if (typeof doc.putTotalPages === 'function') {
    doc.putTotalPages(totalPagesExp);
  }

  // Return the PDF buffer
  return doc.output('arraybuffer');
};

export const generateLeavesCsv = async (data) => {
  // headers
  const headers = ['From Date', 'To Date', 'Staff ID', 'Staff Name', 'Type', 'Reason', 'Date Applied', 'Status'];

  const getLeaveType = (type) => {
    switch (type) {
      case 'sick':
        return 'Sick Leave';
      case 'casual':
        return 'Casual Leave';
      case 'holidayLeave':
        return 'Holiday Leave';
      default:
        return type;
    }
  };

  //  rows
  const rows = data?.map((row) => [
    format(row.dateFrom, 'dd-MM-yyyy'),
    format(row.dateTo, 'dd-MM-yyyy'),
    row.staff?.staffId,
    row.staff?.fullName,
    getLeaveType(row.type),
    row.reason,
    format(row.createdAt, 'dd-MM-yyyy'),
    row.status,
  ]);

  // Generate CSV string
  const csvString = await writeToString(rows, { headers });
  return csvString;
};

export const generateDepartmentWiseAttendance = async (filters) => {
  const { office, startDate, endDate } = filters;
  const matchQuery = {
    date: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
    office,
  };

  const report = await Attendance.aggregate([
    // Match logs for selected months
    { $match: matchQuery },

    // Group attendance records by staff
    {
      $group: {
        _id: '$staffId',
        totalDays: { $addToSet: '$date' },
        fullDays: { $sum: { $cond: [{ $eq: ['$status', 'full-day'] }, 1, 0] } },
        halfDays: { $sum: { $cond: [{ $eq: ['$status', 'half-day'] }, 1, 0] } },
        lateEntries: { $sum: { $cond: [{ $eq: ['$allowedLate', true] }, 1, 0] } },
        paidLeaves: { $sum: { $cond: [{ $eq: ['$leaveStatus', 'paid'] }, 1, 0] } },
        absents: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        holidays: { $sum: { $cond: [{ $eq: ['$status', 'holiday'] }, 1, 0] } },
        weekOffs: { $sum: { $cond: [{ $eq: ['$status', 'week-off'] }, 1, 0] } },
      },
    },

    // Lookup staff details from Staff collection
    {
      $lookup: {
        from: 'staffs',
        localField: '_id',
        foreignField: '_id',
        as: 'staffData',
      },
    },
    {
      $addFields: {
        staffId: { $arrayElemAt: ['$staffData.staffId', 0] },
        name: { $arrayElemAt: ['$staffData.fullName', 0] },
        department: { $arrayElemAt: ['$staffData.department', 0] },
      },
    },

    //Lookup department details from Department collection
    {
      $lookup: {
        from: 'departments',
        localField: 'department',
        foreignField: '_id',
        as: 'departmentData',
      },
    },
    {
      $addFields: {
        departmentName: { $arrayElemAt: ['$departmentData.name', 0] },
      },
    },

    // Calculate total working days
    {
      $addFields: {
        workingDays: { $subtract: [{ $size: '$totalDays' }, { $sum: ['$holidays', '$weekOffs'] }] },
      },
    },

    // Format final output
    {
      $project: {
        _id: 0,
        staffId: 1,
        name: 1,
        workingDays: 1,
        weekOffs: 1,
        holidays: 1,
        fullDays: 1,
        halfDays: 1,
        lateEntries: 1,
        paidLeaves: 1,
        absents: 1,
        department: 1,
        departmentName: 1,
      },
    },

    // Group by department
    {
      $group: {
        _id: '$department',
        departmentName: { $first: '$departmentName' },
        staff: { $push: '$$ROOT' },
      },
    },

    // Sort departments
    { $sort: { departmentName: 1, name: 1 } },
  ]);
  return report;
};

export const generateDepartmentAttendancePDF = async (officeName, data, monthInput) => {
  const doc = new jsPDF({ format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Common header + footer drawer
  const drawCommonHeaderFooter = () => {
    // HEADER
    doc.setFontSize(22);
    doc.setFont('times', 'bold');
    doc.setTextColor('#1ABD9C');
    doc.text('ATTENDANCE REPORT', pageWidth / 2, 15, { align: 'center' });

    doc.setFontSize(14);
    doc.setTextColor('black');
    doc.text(officeName, pageWidth / 2, 22, { align: 'center' });
    doc.setLineWidth(0.2);
    doc.line(10, 27, pageWidth - 10, 27);

    // FOOTER
    const pageCount = doc.internal.getNumberOfPages();
    const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFontSize(10);
    doc.setTextColor('gray');
    doc.text(`Page ${currentPage} of ${pageCount}`, pageWidth - 40, pageHeight - 10);
    doc.text(`Generated: ${format(new Date(), 'dd-MM-yyyy hh:mmaa')}`, 10, pageHeight - 10);
  };

  // Loop over departments
  data.forEach((dept, index) => {
    if (index > 0) doc.addPage();

    // Department title
    doc.setFontSize(12);
    doc.setTextColor('black');
    doc.text(`Department: ${dept.departmentName} | Month: ${format(new Date(monthInput), 'MMMM, yyyy')}`, 10, 35);

    // Table data
    const headers = [['Staff ID', 'Name', 'WD', 'WO', 'H', 'FD', 'HD', 'LE', 'PL', 'A']];
    const rows = dept.staff.map((staff) => [
      staff.staffId,
      staff.name,
      staff.workingDays,
      staff.weekOffs,
      staff.holidays,
      staff.fullDays,
      staff.halfDays,
      staff.lateEntries,
      staff.paidLeaves,
      staff.absents,
    ]);

    autoTable(doc, {
      startY: 40,
      margin: 10,
      head: headers,
      body: rows,
      theme: 'grid',
      didDrawPage: drawCommonHeaderFooter,
    });
  });
  return doc.output('arraybuffer');
};

export const generatePerformanceReport = async (filters) => {
  const { office, rankBy, startDate, endDate, order = 'asc' } = filters;
  const orderBy = order === 'asc' ? 1 : -1;

  const report = await Attendance.aggregate([
    {
      $match: {
        office,
        date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      },
    },
    {
      $group: {
        _id: '$staffId',
        fullDays: { $sum: { $cond: [{ $eq: ['$status', 'full-day'] }, 1, 0] } },
        halfDays: { $sum: { $cond: [{ $eq: ['$status', 'half-day'] }, 1, 0] } },
        absents: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        paidLeaves: { $sum: { $cond: [{ $eq: ['$leaveStatus', 'paid'] }, 1, 0] } },
        unpaidLeaves: { $sum: { $cond: [{ $eq: ['$leaveStatus', 'unpaid'] }, 1, 0] } },
        breakTime: { $sum: '$breakTime' },
        workTime: { $sum: '$totalWorkTime' },
      },
    },
    {
      $lookup: {
        from: 'staffs',
        let: { staffId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: ['$_id', '$$staffId'],
              },
            },
          },
          {
            $project: {
              _id: 0,
              fullName: 1,
              staffId: 1,
            },
          },
        ],
        as: 'staff',
      },
    },
    {
      $unwind: '$staff',
    },
    {
      $sort: {
        [rankBy]: orderBy,
        'staff.fullName': 1,
      },
    },
  ]);

  return report;
};

export const generatePerformanceReportPDF = async (officeName, data, filters) => {
  var doc = new jsPDF({ format: 'a4' });
  // Get the page height and width
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const totalPagesExp = '{total_pages_count_string}';

  const drawHeaderFooter = () => {
    // Title
    doc.setFontSize(22);
    doc.setFont('times', 'bold');
    doc.setTextColor('#1ABD9C');
    doc.text('PERFORMANCE REPORT', pageWidth / 2, 15, { align: 'center' });

    // Subtitle
    doc.setFontSize(14);
    doc.setTextColor('black');
    doc.text(officeName, pageWidth / 2, 22, { align: 'center' });
    doc.setLineWidth(0.2);
    doc.line(10, 27, pageWidth - 10, 27);

    // Filters applied
    doc.setFontSize(12);
    autoTable(doc, {
      startY: 30,
      body: [
        [`From: ${filters.startDate || '-'}`, `To: ${filters.endDate || '-'}`],
        [
          `Rank By: ${voca.titleCase(voca.snakeCase(filters.rankBy))}`,
          `Sort By: ${filters.orderBy === 'asc' ? 'Highest' : 'Lowest'}`,
        ],
      ],
      theme: 'grid',
      bodyStyles: { fontStyle: 'bold' },
    });

    // FOOTER
    const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFontSize(10);
    doc.setTextColor('gray');
    doc.text(`Page ${currentPage} of ${totalPagesExp}`, pageWidth - 40, pageHeight - 10);
    doc.text(`Generated: ${format(new Date(), 'dd-MM-yyyy hh:mmaa')}`, 10, pageHeight - 10);
  };

  // Table headers
  const headers = [['Staff Id', 'Staff Name', 'Full Days', 'Half Days', 'Absents', 'Paid Leaves', 'Unpaid Leaves']];

  // Table rows
  const rows = data?.map((row) => [
    row.staff?.staffId,
    row.staff?.fullName,
    row.fullDays,
    row.halfDays,
    row.absents,
    row.paidLeaves,
    row.unpaidLeaves,
  ]);

  // Add table to the document
  autoTable(doc, {
    margin: { top: 50, bottom: 15 },
    head: headers,
    body: rows,
    theme: 'grid',
    didDrawPage: drawHeaderFooter,
  });

  if (typeof doc.putTotalPages === 'function') {
    doc.putTotalPages(totalPagesExp);
  }

  // Return the PDF buffer
  return doc.output('arraybuffer');
};

const safeToFixed = (val) => (typeof val === 'number' ? val.toFixed(2) : (0).toFixed(2));

export const generateMonthlySalaryReport = async (office, month, year) => {
  const [report, salaryStructure, officeDoc] = await Promise.all([
    Salary.aggregate([
      {
        $match: {
          office,
          month: Number(month),
          year: Number(year),
        },
      },
      {
        $lookup: {
          from: 'staffs',
          localField: 'staff',
          foreignField: '_id',
          as: 'staffDetails',
        },
      },
      { $unwind: '$staffDetails' },
      {
        $lookup: {
          from: 'departments',
          localField: 'staffDetails.department',
          foreignField: '_id',
          as: 'departmentDetails',
        },
      },
      { $unwind: '$departmentDetails' },
      {
        $group: {
          _id: '$departmentDetails._id',
          departmentName: { $first: '$departmentDetails.name' },
          staffs: {
            $push: {
              fullName: '$staffDetails.fullName',
              staffId: '$staffDetails.staffId',
              pfNo: '$staffDetails.pfNo',
              esiNo: '$staffDetails.esiNo',
              totalPayableDays: '$totalPayableDays',
              breakdown: '$breakdown',
              deductions: '$deductions',
              grossSalary: '$grossSalary',
              netSalary: '$netSalary',
              advanceDeduction: '$breakdown.advanceDeduction',
            },
          },
          totalGrossSalary: { $sum: '$grossSalary' },
          totalNetSalary: { $sum: '$netSalary' },
          totalBasic: { $sum: '$breakdown.basic' },
          totalDa: { $sum: '$breakdown.da' },
          totalHra: { $sum: '$breakdown.hra' },
          totalConveyance: { $sum: '$breakdown.conveyance' },
          totalSpecialAllowance: { $sum: '$breakdown.specialAllowance' },
          totalOtherAllowance: { $sum: '$breakdown.otherAllowance' },
          totalPfDeduction: { $sum: '$breakdown.pf' },
          totalEsiDeduction: { $sum: '$breakdown.esi' },
          totalPTaxDeduction: { $sum: '$breakdown.pTax' },
          totalLwfDeduction: { $sum: '$breakdown.lwf' },
          totalAdvanceDeduction: { $sum: '$breakdown.advanceDeduction' },
          totalDeductions: { $sum: '$deductions' },
        },
      },
      { $sort: { departmentName: 1, 'staffs.fullName': 1 } },
    ]),
    SalaryStructure.findOne({ office }).lean(),
    Office.findOne({ _id: office }).select('name'),
  ]);

  // Generate PDF
  if (!report || report.length === 0) return;
  if (!salaryStructure) {
    throw new ApiError(404, 'Not Found!', 'Salary configuration not found for this office.');
  }

  const officeName = officeDoc?.name;

  // ================================================================
  // Build column definitions dynamically based on which components
  // are enabled in this office's Salary Structure settings.
  // Each def carries: header label, per-staff value getter (safe via
  // safeToFixed), and the matching department-total getter — so
  // header/row/totals can never drift out of alignment.
  // ================================================================
  const columnDefs = [
    {
      header: 'Staff',
      getValue: (s) => `${s.fullName}\n\n${s.pfNo ? `PF: ${s.pfNo}` : ''}\n${s.esiNo ? `ESI: ${s.esiNo}` : ''}`,
      getTotal: null, // covered by colSpan in totals row
    },
    { header: 'WD', getValue: (s) => s.totalPayableDays, getTotal: null },
    { header: 'Basic', getValue: (s) => safeToFixed(s.breakdown?.basic), getTotal: (d) => safeToFixed(d.totalBasic) },
  ];

  if (salaryStructure.da?.enabled) {
    columnDefs.push({
      header: 'DA',
      getValue: (s) => safeToFixed(s.breakdown?.da),
      getTotal: (d) => safeToFixed(d.totalDa),
    });
  }
  if (salaryStructure.hra?.enabled) {
    columnDefs.push({
      header: 'HRA',
      getValue: (s) => safeToFixed(s.breakdown?.hra),
      getTotal: (d) => safeToFixed(d.totalHra),
    });
  }
  if (salaryStructure.specialAllowance?.enabled) {
    columnDefs.push({
      header: 'Spcl Allow',
      getValue: (s) => safeToFixed(s.breakdown?.specialAllowance),
      getTotal: (d) => safeToFixed(d.totalSpecialAllowance),
    });
  }
  if (salaryStructure.otherAllowance?.enabled) {
    columnDefs.push({
      header: 'Other Allow',
      getValue: (s) => safeToFixed(s.breakdown?.otherAllowance),
      getTotal: (d) => safeToFixed(d.totalOtherAllowance),
    });
  }

  // Gross Wages = earnings before conveyance is folded in (matches payslip logic)
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
    getTotal: (d) =>
      safeToFixed(
        (d.totalBasic ?? 0) +
          (d.totalDa ?? 0) +
          (d.totalHra ?? 0) +
          (d.totalOtherAllowance ?? 0) +
          (d.totalSpecialAllowance ?? 0)
      ),
  });

  if (salaryStructure.conveyance?.enabled) {
    columnDefs.push({
      header: 'Conv A',
      getValue: (s) => safeToFixed(s.breakdown?.conveyance),
      getTotal: (d) => safeToFixed(d.totalConveyance),
    });
  }

  columnDefs.push({
    header: 'Gross',
    getValue: (s) => safeToFixed(s.grossSalary),
    getTotal: (d) => safeToFixed(d.totalGrossSalary),
  });

  if (salaryStructure.pf?.enabled) {
    columnDefs.push({
      header: 'PF',
      getValue: (s) => safeToFixed(s.breakdown?.pf),
      getTotal: (d) => safeToFixed(d.totalPfDeduction),
    });
  }
  if (salaryStructure.esi?.enabled) {
    columnDefs.push({
      header: 'ESI',
      getValue: (s) => safeToFixed(s.breakdown?.esi),
      getTotal: (d) => safeToFixed(d.totalEsiDeduction),
    });
  }
  if (salaryStructure.pTax?.enabled) {
    columnDefs.push({
      header: 'P.Tax',
      getValue: (s) => safeToFixed(s.breakdown?.pTax),
      getTotal: (d) => safeToFixed(d.totalPTaxDeduction),
    });
  }
  if (salaryStructure.lwf?.enabled) {
    columnDefs.push({
      header: 'LWF',
      getValue: (s) => safeToFixed(s.breakdown?.lwf),
      getTotal: (d) => safeToFixed(d.totalLwfDeduction),
    });
  }

  // Always shown — real schema fields with defaults, not toggles.
  columnDefs.push({
    header: 'Adv',
    getValue: (s) => safeToFixed(s.advanceDeduction),
    getTotal: (d) => safeToFixed(d.totalAdvanceDeduction),
  });
  columnDefs.push({
    header: 'Dedct',
    getValue: (s) => safeToFixed(s.deductions),
    getTotal: (d) => safeToFixed(d.totalDeductions),
  });
  columnDefs.push({
    header: 'Net',
    getValue: (s) => safeToFixed(s.netSalary),
    getTotal: (d) => safeToFixed(d.totalNetSalary),
  });
  columnDefs.push({ header: 'Signature', getValue: () => '', getTotal: () => '' });

  // Number of leading columns that get merged under "Total:" label
  // (every column up to and including Gross has no meaningful per-dept total to show individually)
  const totalLabelColSpan = columnDefs.findIndex((col) => col.header === 'Gross') + 1;

  const doc = new jsPDF({ format: 'a4', orientation: 'landscape' });
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const totalPagesExp = '{total_pages_count_string}';

  const drawHeaderFooter = () => {
    // Title
    doc.setFontSize(22);
    doc.setFont('times', 'bold');
    doc.setTextColor('#1ABD9C');
    doc.text('MONTHLY PAY REPORT', pageWidth / 2, 15, { align: 'center' });

    // Subtitle
    doc.setFontSize(14);
    doc.setTextColor('black');
    doc.text(officeName, pageWidth / 2, 22, { align: 'center' });
    doc.setLineWidth(0.2);
    doc.line(10, 27, pageWidth - 10, 27);

    // FOOTER — dashed separator + "For {office}" (matches payslip footer style)
    const currentPage = doc.internal.getCurrentPageInfo().pageNumber;

    doc.setLineWidth(0.2);
    doc.setLineDashPattern([2, 1]);
    doc.line(10, pageHeight - 18, pageWidth - 10, pageHeight - 18);
    doc.setLineDashPattern([]); // reset dash for subsequent draws

    doc.setFontSize(8);
    const officeUseText = `For ${officeName || ''}`;
    const officeTextWidth = doc.getTextWidth(officeUseText);
    doc.text(officeUseText, pageWidth - 10 - officeTextWidth, pageHeight - 14);

    doc.setFontSize(10);
    doc.setTextColor('gray');
    doc.text(`Page ${currentPage} of ${totalPagesExp}`, pageWidth - 40, pageHeight - 10);
    doc.text(`Generated: ${format(new Date(), 'dd-MM-yyyy hh:mmaa')}`, 10, pageHeight - 10);
  };

  report.forEach((dept, index) => {
    if (index > 0) doc.addPage();

    doc.setFontSize(12);
    doc.setTextColor('black');
    doc.text(`Department: ${dept.departmentName} | Month: ${format(new Date(year, month - 1), 'MMMM, yyyy')}`, 10, 35);

    const headers = [columnDefs.map((col) => col.header)];

    const rows = dept.staffs.map((staff) => columnDefs.map((col) => col.getValue(staff)));

    // Totals row: first `totalLabelColSpan` columns merge under "Total:",
    // remaining columns pull their sum from the matching getTotal().
    const totalsRow = [
      {
        content: 'Total:',
        colSpan: totalLabelColSpan,
        styles: { halign: 'right' },
      },
      ...columnDefs.slice(totalLabelColSpan).map((col) => (col.getTotal ? col.getTotal(dept) : '')),
    ];

    rows.push(totalsRow);

    autoTable(doc, {
      startY: 40,
      margin: 10,
      head: headers,
      body: rows,
      theme: 'grid',
      didParseCell: (data) => {
        if (data.row.index === rows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
      didDrawPage: drawHeaderFooter,
    });
  });

  if (typeof doc.putTotalPages === 'function') {
    doc.putTotalPages(totalPagesExp);
  }

  return doc.output('arraybuffer');
};

export const generatePfEcrCsv = async (office, month, year) => {
  const allSalaries = await Salary.find({ office, month, year }).populate('staff', 'fullName pfNo');

  if (!allSalaries || allSalaries.length === 0) return;
  // headers
  const headers = [
    'PF_No',
    'Name',
    'Gross_Wages',
    'EPF_Wages',
    'EPS_Wages',
    'EDLI_Wages',
    'EPF_Cont_Remitted',
    'EPS_Cont_Remitted',
    'EPF_EPS_Diff_Remitted',
    'NCP_Days',
    'Refund_of_advances',
  ];

  //  rows
  const rows = allSalaries
    ?.filter((row) => row.staff?.pfNo)
    .map((row) => [
      row.staff?.pfNo,
      row.staff?.fullName,
      row.grossSalary,
      row.breakdown.basic,
      row.breakdown.basic,
      row.breakdown.basic,
      row.breakdown.pf,
      Math.round((row.breakdown.pf * 8.33) / 12),
      Math.round((row.breakdown.pf * 3.67) / 12),
      row.leaves.totalUnpaidLeaves + row.leaves.totalHolidayLeaves,
      0,
    ]);

  // Generate CSV string
  const csvString = await writeToString(rows, { headers });
  return csvString;
};

export const generateEsiEcrCsv = async (office, month, year) => {
  const allSalaries = await Salary.find({ office, month, year }).populate('staff', 'fullName esiNo');

  if (!allSalaries || allSalaries.length === 0) return;
  // headers
  const headers = ['IP_No', 'IP_Name', 'No_of_Days', 'Total_Monthly_Wages', 'Reason_Code', 'Last_Working_Day'];

  //  rows
  const rows = allSalaries
    ?.filter((row) => row.staff?.esiNo)
    .map((row) => [row.staff?.esiNo, row.staff?.fullName, row.totalPayableDays, row.grossSalary, '', '']);

  // Generate CSV string
  const csvString = await writeToString(rows, { headers });
  return csvString;
};

export const generateHolidayFundReport = async (filters) => {
  const { startMonth, endMonth, office, staff, sortBy, sortOrder = 'asc', limit, page = 1 } = filters;

  try {
    let filter = { office };

    // Month range filter
    if (startMonth || endMonth) {
      const rangeQuery = [];

      if (startMonth) {
        const [startYear, startMonthNumber] = startMonth.split('-').map(Number);

        rangeQuery.push({
          $or: [{ year: { $gt: startYear } }, { year: startYear, month: { $gte: startMonthNumber } }],
        });
      }

      if (endMonth) {
        const [endYear, endMonthNumber] = endMonth.split('-').map(Number);

        rangeQuery.push({
          $or: [{ year: { $lt: endYear } }, { year: endYear, month: { $lte: endMonthNumber } }],
        });
      }

      if (rangeQuery.length === 2) {
        filter.$and = rangeQuery;
      } else if (rangeQuery.length === 1) {
        Object.assign(filter, rangeQuery[0]);
      }
    }

    // Staff filter
    if (staff) filter.staff = staff;

    // Sorting
    const sort = sortBy
      ? { [sortBy]: sortOrder === 'desc' ? -1 : 1 }
      : {
          year: sortOrder === 'desc' ? -1 : 1,
          month: sortOrder === 'desc' ? -1 : 1,
        };

    // Base query
    let query = HolidayFund.find(filter).select('-__v -office').populate('staff', 'staffId fullName').sort(sort);

    // Apply pagination only if limit exists
    if (limit) {
      const skip = (page - 1) * Number(limit);
      query = query.skip(skip).limit(Number(limit));
    }

    const report = await query;

    const totalRecords = await HolidayFund.countDocuments(filter);

    return {
      report,
      pagination: limit
        ? {
            totalRecords,
            totalPages: Math.ceil(totalRecords / limit),
            currentPage: Number(page),
            limit: Number(limit),
          }
        : null,
    };
  } catch (error) {
    throw error;
  }
};

export const generateHolidayFundReportPdf = async (officeName, data, filters) => {
  var doc = new jsPDF({ format: 'a4' });
  // Get the page height and width
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const totalPagesExp = '{total_pages_count_string}';

  const drawHeaderFooter = () => {
    // Title
    doc.setFontSize(22);
    doc.setFont('times', 'bold');
    doc.setTextColor('#1ABD9C');
    doc.text('HOLIDAY FUND REPORT', pageWidth / 2, 15, { align: 'center' });

    // Subtitle
    doc.setFontSize(14);
    doc.setTextColor('black');
    doc.text(officeName, pageWidth / 2, 22, { align: 'center' });
    doc.setLineWidth(0.2);
    doc.line(10, 27, pageWidth - 10, 27);

    // Filters applied
    doc.setFontSize(12);
    autoTable(doc, {
      startY: 30,
      body: [
        [
          `From Month: ${filters.startMonth && !filters.month ? filters.startMonth : '-'}`,
          `To Month: ${filters.endMonth && !filters.month ? filters.endMonth : '-'}`,
        ],
        [
          `Staff: ${filters.staff ? `${data[0]?.staff?.staffId} - ${data[0]?.staff?.fullName}` : 'All'}`,
          `Sort By: ${filters.sortBy || 'Month-Year'}`,
        ],
      ],
      theme: 'grid',
      bodyStyles: { fontStyle: 'bold' },
    });

    // FOOTER
    const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFontSize(10);
    doc.setTextColor('gray');
    doc.text(`Page ${currentPage} of ${totalPagesExp}`, pageWidth - 40, pageHeight - 10);
    doc.text(`Generated: ${format(new Date(), 'dd-MM-yyyy hh:mmaa')}`, 10, pageHeight - 10);
  };

  // Table headers
  const headers = [['Month', 'Staff ID', 'Staff Name', 'Amount']];

  // Table rows
  const rows = data?.map((row) => [
    format(new Date(row.year, row.month - 1), 'MMM - yyyy'),
    row.staff?.staffId,
    row.staff?.fullName,
    row.amount.toFixed(2),
  ]);

  // Add table to the document
  autoTable(doc, {
    margin: { top: 50, bottom: 15 },
    head: headers,
    body: rows,
    theme: 'grid',
    didDrawPage: drawHeaderFooter,
  });

  if (typeof doc.putTotalPages === 'function') {
    doc.putTotalPages(totalPagesExp);
  }

  // Return the PDF buffer
  return doc.output('arraybuffer');
};

export const generateHolidayFundReportCsv = async (data) => {
  // headers
  const headers = ['Month', 'Staff ID', 'Staff Name', 'Amount'];

  //  rows
  const rows = data?.map((row) => [
    format(new Date(row.year, row.month - 1), 'MMM - yyyy'),
    row.staff?.staffId,
    row.staff?.fullName,
    row.amount.toFixed(2),
  ]);

  // Generate CSV string
  const csvString = await writeToString(rows, { headers });
  return csvString;
};

// ======================= ADVANCE REPORT =======================
const advDate = (d) => (d ? format(new Date(d), 'dd/MM/yyyy') : '-');
const advMoney = (n) => (Number(n) || 0).toFixed(2);
const advNo = (n) => `ADV-${String(n).padStart(4, '0')}`;
const advMonthIndex = (ym) => {
  if (!ym) return null;
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m) return null;
  return y * 12 + (m - 1);
};
const advPeriodLabel = (f = {}) =>
  f.startMonth || f.endMonth ? `${f.startMonth || 'Start'} to ${f.endMonth || 'Present'}` : 'All Time';

const advThinBorder = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

// Prottek 'add' transaction = 1 ta advance. Er por theke next 'add' er age porjonto
// 'deduct' / 'update' row gulo oi advance er.
const buildAdvanceRecords = async (office) => {
  const [adds, others] = await Promise.all([
    AdvanceTransaction.find({ office, type: 'add' }).sort({ createdAt: 1 }).lean(),
    AdvanceTransaction.find({ office, type: { $in: ['deduct', 'update'] } })
      .sort({ createdAt: 1 })
      .lean(),
  ]);
  if (!adds.length) return [];

  const staffIds = [...new Set(adds.map((a) => String(a.staff)))];
  const staffDocs = await Staff.find({ _id: { $in: staffIds } })
    .select('staffId fullName department advanceSalary')
    .populate('department', 'name')
    .lean();
  const staffMap = new Map(staffDocs.map((s) => [String(s._id), s]));

  // Advance number: office-er sob advance chronological order e (stable, notun advance sob somoy sheshe boshe)
  const addsByStaff = new Map();
  adds.forEach((a, i) => {
    a._no = i + 1;
    const k = String(a.staff);
    if (!addsByStaff.has(k)) addsByStaff.set(k, []);
    addsByStaff.get(k).push(a);
  });

  const othersByStaff = new Map();
  others.forEach((t) => {
    const k = String(t.staff);
    if (!othersByStaff.has(k)) othersByStaff.set(k, []);
    othersByStaff.get(k).push(t);
  });

  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const records = [];

  for (const [staffKey, staffAdds] of addsByStaff) {
    const staff = staffMap.get(staffKey);
    if (!staff) continue;
    const staffOthers = othersByStaff.get(staffKey) || [];

    staffAdds.forEach((add, idx) => {
      const start = new Date(add.createdAt).getTime();
      const end = idx < staffAdds.length - 1 ? new Date(staffAdds[idx + 1].createdAt).getTime() : Infinity;
      const windowTx = staffOthers.filter((t) => {
        const ts = new Date(t.createdAt).getTime();
        return ts >= start && ts < end;
      });

      // Staff e ekta-i active advance thake (latest 'add'). Purono gulo already closed.
      const isLatest = idx === staffAdds.length - 1;
      const adv = staff.advanceSalary;
      const active = Boolean(isLatest && adv && Number(adv.remainingAmount) > 0);

      const advanceAmount = Number(add.amount) || 0;
      const pendingAmount = active ? Number(adv.remainingAmount) : 0;
      const totalRepaid = Math.min(advanceAmount, Math.max(0, advanceAmount - pendingAmount));

      // Last payment = last salary deduction ba remaining komiye deoa adjustment / mark-as-paid
      const payments = windowTx.filter((t) =>
        t.type === 'deduct' ? Number(t.amount) > 0 : Number(t.previousAmount) > Number(t.newAmount)
      );
      const lastPaymentDate = payments.length ? payments[payments.length - 1].createdAt : null;

      let status = 'Closed';
      if (active) {
        const paused = (adv.pausedMonths || []).some((p) => p.month === curMonth && p.year === curYear);
        status = paused ? 'Paused' : 'Active';
      }

      records.push({
        _id: String(add._id),
        advanceNo: advNo(add._no),
        dateOfAdvance: add.dateTaken || add.createdAt,
        staff: String(staff._id),
        staffId: staff.staffId,
        staffName: staff.fullName,
        departmentId: staff.department?._id ? String(staff.department._id) : 'none',
        departmentName: staff.department?.name || 'No Department',
        advanceAmount,
        totalRepaid,
        pendingAmount,
        lastPaymentDate,
        remainingMonths: active ? Number(adv.remainingMonths) || 0 : 0,
        monthlyDeduction: active ? Number(adv.monthlyDeduction) || 0 : 0,
        pausedMonths: active ? adv.pausedMonths || [] : [],
        status,
        remarks: add.remarks || '',
        transactions: [add, ...windowTx].map((t) => ({
          _id: String(t._id),
          type: t.type,
          amount: t.amount,
          month: t.month,
          year: t.year,
          previousAmount: t.previousAmount,
          newAmount: t.newAmount,
          previousMonths: t.previousMonths,
          newMonths: t.newMonths,
          remarks: t.remarks || '',
          createdAt: t.createdAt,
        })),
      });
    });
  }

  return records;
};

export const generateAdvanceReport = async (filters) => {
  const { office, department, staff, startMonth, endMonth, status } = filters;

  let records = await buildAdvanceRecords(office);

  if (department) records = records.filter((r) => r.departmentId === String(department));
  if (staff) records = records.filter((r) => r.staff === String(staff));

  const from = advMonthIndex(startMonth);
  const to = advMonthIndex(endMonth);
  if (from !== null || to !== null) {
    records = records.filter((r) => {
      const d = new Date(r.dateOfAdvance);
      const idx = d.getFullYear() * 12 + d.getMonth();
      return (from === null || idx >= from) && (to === null || idx <= to);
    });
  }

  if (status === 'active') records = records.filter((r) => r.status !== 'Closed');
  else if (status === 'closed') records = records.filter((r) => r.status === 'Closed');

  // Department wise group (attendance report er moto)
  const groups = new Map();
  records.forEach((r) => {
    const { transactions, ...row } = r; // list e transactions lagbe na
    if (!groups.has(r.departmentId)) {
      groups.set(r.departmentId, {
        _id: r.departmentId,
        departmentName: r.departmentName,
        advances: [],
        totals: { advanceAmount: 0, totalRepaid: 0, pendingAmount: 0 },
      });
    }
    const g = groups.get(r.departmentId);
    g.advances.push(row);
    g.totals.advanceAmount += row.advanceAmount;
    g.totals.totalRepaid += row.totalRepaid;
    g.totals.pendingAmount += row.pendingAmount;
  });

  return [...groups.values()]
    .map((g) => ({
      ...g,
      advances: g.advances.sort(
        (a, b) =>
          (a.staffName || '').localeCompare(b.staffName || '') || new Date(a.dateOfAdvance) - new Date(b.dateOfAdvance)
      ),
    }))
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName));
};

export const getAdvanceDetail = async (office, advanceId) => {
  const records = await buildAdvanceRecords(office);
  return records.find((r) => r._id === String(advanceId)) || null;
};

export const generateAdvanceReportPdf = async (officeName, groups, filters = {}) => {
  const doc = new jsPDF({ format: 'a4', orientation: 'landscape' });
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const totalPagesExp = '{total_pages_count_string}';

  const drawHeaderFooter = () => {
    doc.setFontSize(22);
    doc.setFont('times', 'bold');
    doc.setTextColor('#1ABD9C');
    doc.text('ADVANCE REPORT', pageWidth / 2, 15, { align: 'center' });

    doc.setFontSize(14);
    doc.setTextColor('black');
    doc.text(officeName || '', pageWidth / 2, 22, { align: 'center' });
    doc.setLineWidth(0.2);
    doc.line(10, 27, pageWidth - 10, 27);

    const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFontSize(10);
    doc.setTextColor('gray');
    doc.text(`Page ${currentPage} of ${totalPagesExp}`, pageWidth - 40, pageHeight - 10);
    doc.text(`Generated: ${format(new Date(), 'dd-MM-yyyy hh:mmaa')}`, 10, pageHeight - 10);
  };

  const headers = [
    [
      'Sl',
      'Adv No',
      'Date of Advance',
      'Staff',
      'Advance Amt',
      'Total Repaid',
      'Last Payment',
      'Pending Amt',
      'Rem. Months',
      'Status',
    ],
  ];

  groups.forEach((dept, index) => {
    if (index > 0) doc.addPage();

    doc.setFontSize(12);
    doc.setFont('times', 'bold');
    doc.setTextColor('black');
    doc.text(`Department: ${dept.departmentName} | Period: ${advPeriodLabel(filters)}`, 10, 35);

    const rows = dept.advances.map((a, i) => [
      i + 1,
      a.advanceNo,
      advDate(a.dateOfAdvance),
      `${a.staffName}\n${a.staffId || ''}`,
      advMoney(a.advanceAmount),
      advMoney(a.totalRepaid),
      advDate(a.lastPaymentDate),
      advMoney(a.pendingAmount),
      a.remainingMonths,
      a.status,
    ]);

    rows.push([
      { content: 'Total:', colSpan: 4, styles: { halign: 'right' } },
      advMoney(dept.totals.advanceAmount),
      advMoney(dept.totals.totalRepaid),
      '',
      advMoney(dept.totals.pendingAmount),
      '',
      '',
    ]);

    autoTable(doc, {
      startY: 40,
      margin: { top: 40, left: 10, right: 10, bottom: 15 },
      head: headers,
      body: rows,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [46, 134, 171] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === rows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
      didDrawPage: drawHeaderFooter,
    });
  });

  if (typeof doc.putTotalPages === 'function') {
    doc.putTotalPages(totalPagesExp);
  }

  return doc.output('arraybuffer');
};

export const generateAdvanceReportExcel = async (officeName, groups, filters = {}) => {
  const headers = [
    'SL NO',
    'ADVANCE NO',
    'DATE OF ADVANCE',
    'STAFF ID',
    'STAFF NAME',
    'DEPARTMENT',
    'ADVANCE AMOUNT',
    'TOTAL REPAID',
    'LAST PAYMENT DATE',
    'PENDING AMOUNT',
    'REMAINING MONTHS',
    'STATUS',
  ];
  const widths = [7, 13, 16, 12, 24, 18, 15, 14, 18, 15, 16, 10];
  const colCount = headers.length;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Advance Report');
  widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w));

  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

  sheet.mergeCells(1, 1, 1, colCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = (officeName || 'COMPANY NAME').toUpperCase();
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = fill('FFB39DDB');
  sheet.getRow(1).height = 20;

  sheet.mergeCells(2, 1, 2, colCount);
  const subCell = sheet.getCell(2, 1);
  subCell.value = `ADVANCE REPORT (${advPeriodLabel(filters)})`;
  subCell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };
  subCell.fill = fill('FF2E86AB');
  sheet.getRow(2).height = 16;

  const headerRow = sheet.getRow(3);
  headers.forEach((h, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = fill('FF2E86AB');
    cell.border = advThinBorder;
  });
  headerRow.height = 24;

  let r = 4;
  const grand = { advanceAmount: 0, totalRepaid: 0, pendingAmount: 0 };

  const writeTotalRow = (label, t) => {
    sheet.mergeCells(r, 1, r, 6);
    const row = sheet.getRow(r);
    const labelCell = row.getCell(1);
    labelCell.value = label;
    const values = { 7: t.advanceAmount, 8: t.totalRepaid, 10: t.pendingAmount };
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      if (values[c] !== undefined) cell.value = values[c];
      cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = fill('FF2E86AB');
      cell.border = advThinBorder;
    }
    r++;
  };

  groups.forEach((dept) => {
    sheet.mergeCells(r, 1, r, colCount);
    const deptCell = sheet.getCell(r, 1);
    deptCell.value = `Department: ${dept.departmentName}`;
    deptCell.font = { bold: true, size: 10 };
    deptCell.alignment = { horizontal: 'left', vertical: 'middle' };
    deptCell.fill = fill('FFE3F2FD');
    deptCell.border = advThinBorder;
    r++;

    dept.advances.forEach((a, i) => {
      const row = sheet.getRow(r);
      const vals = [
        i + 1,
        a.advanceNo,
        advDate(a.dateOfAdvance),
        a.staffId || '-',
        a.staffName,
        a.departmentName,
        a.advanceAmount,
        a.totalRepaid,
        advDate(a.lastPaymentDate),
        a.pendingAmount,
        a.remainingMonths,
        a.status,
      ];
      vals.forEach((v, idx) => {
        const cell = row.getCell(idx + 1);
        cell.value = v;
        cell.font = { size: 9 };
        cell.border = advThinBorder;
        cell.alignment = { horizontal: idx === 4 ? 'left' : 'center' };
      });
      r++;
    });

    writeTotalRow('DEPARTMENT TOTAL', dept.totals);
    grand.advanceAmount += dept.totals.advanceAmount;
    grand.totalRepaid += dept.totals.totalRepaid;
    grand.pendingAmount += dept.totals.pendingAmount;
  });

  if (groups.length > 1) writeTotalRow('GRAND TOTAL', grand);

  return workbook.xlsx.writeBuffer();
};

// ======================= ADVANCE DETAIL PDF =======================
const advDateTime = (d) => (d ? format(new Date(d), 'dd/MM/yyyy hh:mm a') : '-');
const advMonthLabel = (m, y) => (m && y ? format(new Date(y, m - 1, 1), 'MMM yyyy') : '-');
// jsPDF er default font e "→" glyph nai, tai "->" use korlam
const advArrow = (a, b) => (a === undefined && b === undefined ? '-' : `${a ?? '-'} -> ${b ?? '-'}`);
const ADV_TYPE_LABEL = {
  add: 'Advance Given',
  deduct: 'Salary Deduction',
  update: 'Adjustment / Pause',
};

export const generateAdvanceDetailPdf = async (officeName, a) => {
  const doc = new jsPDF({ format: 'a4', orientation: 'landscape' });
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const totalPagesExp = '{total_pages_count_string}';

  // duita autoTable same page e draw korle header/footer jate duibar na ase
  const drawnPages = new Set();
  const drawHeaderFooter = () => {
    const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
    if (drawnPages.has(currentPage)) return;
    drawnPages.add(currentPage);

    doc.setFontSize(22);
    doc.setFont('times', 'bold');
    doc.setTextColor('#1ABD9C');
    doc.text('ADVANCE DETAILS', pageWidth / 2, 15, { align: 'center' });

    doc.setFontSize(14);
    doc.setTextColor('black');
    doc.text(officeName || '', pageWidth / 2, 22, { align: 'center' });
    doc.setLineWidth(0.2);
    doc.line(10, 27, pageWidth - 10, 27);

    doc.setFontSize(10);
    doc.setTextColor('gray');
    doc.text(`Page ${currentPage} of ${totalPagesExp}`, pageWidth - 40, pageHeight - 10);
    doc.text(`Generated: ${format(new Date(), 'dd-MM-yyyy hh:mmaa')}`, 10, pageHeight - 10);
  };

  // ---- Title line ----
  doc.setFontSize(12);
  doc.setFont('times', 'bold');
  doc.setTextColor('black');
  doc.text(`Advance No: ${a.advanceNo} | Status: ${a.status}`, 10, 35);

  // ---- Summary (label | value | label | value) ----
  const summary = [
    ['Staff', `${a.staffName} (${a.staffId || '-'})`],
    ['Department', a.departmentName],
    ['Date of Advance', advDate(a.dateOfAdvance)],
    ['Advance Amount', advMoney(a.advanceAmount)],
    ['Total Repayment Made', advMoney(a.totalRepaid)],
    ['Pending Amount', advMoney(a.pendingAmount)],
    ['Last Payment Date', advDate(a.lastPaymentDate)],
    ['Remaining Months', String(a.remainingMonths ?? 0)],
    ['Monthly Deduction', advMoney(a.monthlyDeduction)],
    ['Remarks', a.remarks || '-'],
  ];
  const summaryRows = [];
  for (let i = 0; i < summary.length; i += 2) {
    summaryRows.push([...summary[i], ...(summary[i + 1] || ['', ''])]);
  }

  autoTable(doc, {
    startY: 40,
    margin: { top: 50, left: 10, right: 10, bottom: 15 },
    body: summaryRows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [226, 232, 240], cellWidth: 45 },
      2: { fontStyle: 'bold', fillColor: [226, 232, 240], cellWidth: 45 },
    },
    didDrawPage: drawHeaderFooter,
  });

  let y = doc.lastAutoTable.finalY + 8;

  // ---- Paused months ----
  if (a.pausedMonths?.length > 0) {
    doc.setFont('times', 'bold');
    doc.setFontSize(10);
    doc.setTextColor('black');
    doc.text(`Paused months: ${a.pausedMonths.map((p) => advMonthLabel(p.month, p.year)).join(', ')}`, 10, y);
    y += 7;
  }

  // ---- Transaction history ----
  if (y > pageHeight - 40) {
    doc.addPage();
    y = 40;
  }
  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.setTextColor('black');
  doc.text('Transaction History', 10, y);

  const rows = (a.transactions || []).map((t) => [
    advDateTime(t.createdAt),
    ADV_TYPE_LABEL[t.type] || t.type,
    advMonthLabel(t.month, t.year),
    advMoney(t.amount),
    advArrow(t.previousAmount, t.newAmount),
    advArrow(t.previousMonths, t.newMonths),
    t.remarks || '-',
  ]);

  autoTable(doc, {
    startY: y + 3,
    margin: { top: 50, left: 10, right: 10, bottom: 15 },
    head: [['Date', 'Type', 'Salary Month', 'Amount', 'Remaining Amt (Old -> New)', 'Months (Old -> New)', 'Remarks']],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [46, 134, 171] },
    columnStyles: { 3: { halign: 'right' } },
    didDrawPage: drawHeaderFooter,
  });

  if (typeof doc.putTotalPages === 'function') {
    doc.putTotalPages(totalPagesExp);
  }

  return doc.output('arraybuffer');
};
