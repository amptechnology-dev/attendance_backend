import { Attendance } from '../models/attendance.model.js';
import { Salary } from '../models/salary.model.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, startOfYear, endOfYear } from 'date-fns';
import { writeToString } from 'fast-csv';
import { Leave } from '../models/leave.model.js';
import { Office } from '../models/office.model.js';
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
    let query = Attendance.find(filter)
      .select('-__v -logs -office')
      .populate('staffId', 'staffId fullName')
      .sort(sort);

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
  const headers = [['Date', 'Staff ID', 'Staff Name', 'Wroking Time', 'Break Time', 'Status', 'HR Adjustments']];

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
  const headers = ['Date', 'Staff ID', 'Staff Name', 'Firsrt Half', 'Second Half', 'Status', 'HR Adjustments'];
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
    // JS Date month index is 0-based
    fromDate = new Date(year, monthNumber - 1, 1);
    toDate = new Date(year, monthNumber, 0, 23, 59, 59, 999);
    // last day of month
  }
  if (fromDate && toDate) {
    matchStage.date = {
      $gte: fromDate,
      $lte: toDate,
    };
  }

  // staff filter
  if (staff) {
    matchStage.staffId = staff;
  }

  return Attendance.aggregate([
    { $match: matchStage },
    // Join staff
    {
      $lookup: {
        from: 'staffs',
        localField: 'staffId',
        foreignField: '_id',
        as: 'staff',
      },
    },
    { $unwind: '$staff' },

    // department filter (after staff join)
    ...(department
      ? [
          {
            $match: {
              'staff.department': department,
            },
          },
        ]
      : []),

    // Join department
    {
      $lookup: {
        from: 'departments',
        localField: 'staff.department',
        foreignField: '_id',
        as: 'department',
      },
    },
    { $unwind: '$department' },

    // Extract entry/exit
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

    // Group by staff
    {
      $group: {
        _id: {
          staff: '$staff._id',
          department: '$department._id',
        },
        staffId: { $first: '$staff.staffId' },
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
        absents: {
          $sum: {
            $cond: [{ $eq: ['$status', 'absent'] }, 1, 0],
          },
        },
        attendances: {
          $push: {
            date: '$date',
            entryTime: '$entryTime',
            exitTime: '$exitTime',
            status: '$status',
          },
        },
      },
    },
    {
      $match: {
        attendances: { $ne: [] }, // remove staff with no attendance
      },
    },
    // Sort by name
    {
      $sort: {
        staffName: 1,
      },
    },

    // Group by department
    {
      $group: {
        _id: '$_id.department',
        departmentName: { $first: '$departmentName' },
        staffReports: {
          $push: {
            staff: '$_id.staff',
            staffId: '$staffId',
            staffName: '$staffName',
            fullDays: '$fullDays',
            halfDays: '$halfDays',
            absents: '$absents',
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
  const {
    startMonth,
    endMonth,
    month,
    office,
    staff,
    status,
    sortBy,
    sortOrder = 'asc',
    limit,
    page = 1,
  } = filters;

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
          $or: [
            { year: { $gt: startYear } },
            { year: startYear, month: { $gte: startMonthNumber } },
          ],
        });
      }

      if (endMonth) {
        const [endYear, endMonthNumber] = endMonth.split('-').map(Number);

        rangeQuery.push({
          $or: [
            { year: { $lt: endYear } },
            { year: endYear, month: { $lte: endMonthNumber } },
          ],
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
    let query = Salary.find(filter)
      .select('-__v -office -breakdown')
      .populate('staff', 'staffId fullName')
      .sort(sort);

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
    let query = Leave.find(filter)
      .select('-__v -office -document')
      .populate('staff', 'staffId fullName')
      .sort(sort);

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

export const generateMonthlySalaryReport = async (office, month, year) => {
  const report = await Salary.aggregate([
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
        totalPfDeduction: { $sum: '$breakdown.pf' },
        totalEsiDeduction: { $sum: '$breakdown.esi' },
        totalPTaxDeduction: { $sum: '$breakdown.pTax' },
        totalAdvanceDeduction: { $sum: '$breakdown.advanceDeduction' },
        totalDeductions: { $sum: '$deductions' },
      },
    },
    { $sort: { departmentName: 1, 'staffs.fullName': 1 } },
  ]);
  // Generate PDF
  if (!report || report.length === 0) return;

  const doc = new jsPDF({ format: 'a4', orientation: 'landscape' });
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const totalPagesExp = '{total_pages_count_string}';
  const { name: officeName } = await Office.findOne({ _id: office }).select('name');

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

    // FOOTER
    const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFontSize(10);
    doc.setTextColor('gray');
    doc.text(`Page ${currentPage} of ${totalPagesExp}`, pageWidth - 40, pageHeight - 10);
    doc.text(`Generated: ${format(new Date(), 'dd-MM-yyyy hh:mmaa')}`, 10, pageHeight - 10);
  };

  report.forEach((dept, index) => {
    if (index > 0) doc.addPage();

    doc.setFontSize(12);
    doc.text(`Department: ${dept.departmentName} | Month: ${format(new Date(year, month - 1), 'MMMM, yyyy')}`, 10, 35);

    // Table Header
    const headers = [
      [
        'Staff',
        'WD',
        'Basic',
        'HRA',
        'Conv A',
        'Otr A',
        'Spcl Allow',
        'Gross',
        'PF',
        'ESI',
        'P.Tax',
        'Adv',
        'Dedct',
        'Net',
        'Signature',
      ],
    ];
    // Table rows
    const rows = dept.staffs.map((staff) => [
      `${staff.fullName}\n\n${staff.pfNo ? `PF: ${staff.pfNo}` : ''}\n${staff.esiNo ? `ESI: ${staff.esiNo}` : ''}`,
      staff.totalPayableDays,
      staff.breakdown.basic,
      staff.breakdown.hra,
      staff.breakdown.conveyance,
      staff.breakdown.otherAllowance,
      staff.breakdown.specialAllowance,
      staff.grossSalary,
      staff.breakdown.pf,
      staff.breakdown.esi,
      staff.breakdown.pTax,
      staff.advanceDeduction,
      staff.deductions,
      staff.netSalary,
      '',
    ]);

    const totalsRow = [
      {
        content: 'Total:',
        colSpan: 7,
        styles: { halign: 'right' },
      },
      dept.totalGrossSalary,
      dept.totalPfDeduction,
      dept.totalEsiDeduction,
      dept.totalPTaxDeduction,
      dept.totalAdvanceDeduction,
      dept.totalDeductions,
      dept.totalNetSalary,
      '',
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
  const {
    startMonth,
    endMonth,
    office,
    staff,
    sortBy,
    sortOrder = 'asc',
    limit,
    page = 1,
  } = filters;

  try {
    let filter = { office };

    // Month range filter
    if (startMonth || endMonth) {
      const rangeQuery = [];

      if (startMonth) {
        const [startYear, startMonthNumber] = startMonth.split('-').map(Number);

        rangeQuery.push({
          $or: [
            { year: { $gt: startYear } },
            { year: startYear, month: { $gte: startMonthNumber } },
          ],
        });
      }

      if (endMonth) {
        const [endYear, endMonthNumber] = endMonth.split('-').map(Number);

        rangeQuery.push({
          $or: [
            { year: { $lt: endYear } },
            { year: endYear, month: { $lte: endMonthNumber } },
          ],
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
    let query = HolidayFund.find(filter)
      .select('-__v -office')
      .populate('staff', 'staffId fullName')
      .sort(sort);

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
