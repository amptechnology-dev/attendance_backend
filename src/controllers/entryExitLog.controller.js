import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { EntryExitLog } from '../models/entryExitLog.model.js';
import { Staff } from '../models/staff.model.js';
import { autoAttendanceCalculateByStaffId } from '../services/attendance.service.js';
import { parseISO, isValid, format, subDays } from 'date-fns';
import {
  getLocalMonthBoundariesFormatted,
  getMonthBoundariesFormatted,
  getCurrentDate,
} from '../utils/dateTime.utils.js';
import mongoose from "mongoose";

// ✅ Safe function to create a new entry log
async function handleVeryNewEntry({ staff, entryTime, date, latestLog, deviceId, remarks }) {
  if (!entryTime || isNaN(entryTime.getTime())) {
    throw new Error('Invalid entryTime in handleNewEntry');
  }

  const log = new EntryExitLog({
    staff: staff._id,
    office: staff.office,
    slNo: latestLog ? latestLog.slNo + 1 : 1,
    date,
    entryTime,
    exitTime: null,
    deviceId,
    remarks,
  });

  await log.save();
  return log;
}

// ✅ Safe function to update exit in latest log
async function handleNewExit({ staff, exitTime, date, latestLog }) {
  if (!exitTime || isNaN(exitTime.getTime())) {
    throw new Error('Invalid exitTime in handleExit');
  }

  latestLog.exitTime = exitTime;
  await latestLog.save();
  return latestLog;
}

// ✅ Main controller to handle logs from agent
export const newEntryExitLogsFromAgent = expressAsyncHandler(async (req, res) => {
  const { officeId, deviceSn, logs } = req.body;

  if (!Array.isArray(logs) || logs.length === 0) {
    throw new ApiError(400, 'No logs provided.');
  }

  const officeIdObj = new mongoose.Types.ObjectId(officeId.trim());
  const results = [];

  for (const log of logs) {
    try {
      const staff = await Staff.findOne({
        office: officeIdObj,
        staffId: String(log.deviceUserId),
        status: 'active',
      });

      if (!staff) {
        results.push({ success: false, error: 'Staff not found', log });
        continue;
      }

      // ✅ timestamp
      const timestamp = new Date(log.recordTime);
      if (isNaN(timestamp.getTime())) {
        results.push({ success: false, error: 'Invalid time value', log });
        continue;
      }

      // ✅ FIX timezone shift (IMPORTANT)
      const localTime = new Date(timestamp.getTime() + (6 * 60 * 60 * 1000)); // BD +6

      // ✅ date only
      const date = new Date(
        localTime.getFullYear(),
        localTime.getMonth(),
        localTime.getDate()
      );

      const latestLog = await EntryExitLog.findOne({
        staff: staff._id,
        date,
      }).sort({ slNo: -1 });

      let finalLog;

      // ✅ USE direction (MAIN FIX)
      if (log.direction === "in") {
        finalLog = await handleVeryNewEntry({
          staff,
          entryTime: localTime,
          date,
          latestLog,
          deviceId: deviceSn,
          remarks: log.remarks || 'Pushed from local agent',
        });
      } else if (log.direction === "out") {
        if (!latestLog || latestLog.exitTime) {
          // ❌ no entry exists
          results.push({ success: false, error: 'No entry found for exit', log });
          continue;
        }

        finalLog = await handleNewExit({
          staff,
          exitTime: localTime,
          date,
          latestLog,
        });
      } else {
        results.push({ success: false, error: 'Invalid direction', log });
        continue;
      }

      await autoAttendanceCalculateByStaffId(
        finalLog.office,
        finalLog.staff,
        finalLog.date
      );

      results.push({ success: true, log: finalLog });

    } catch (err) {
      console.error('❌ Error processing log:', err);
      results.push({ success: false, error: err.message || 'Unknown error', log });
    }
  }

  return new ApiResponse(200, results, 'Batch logs processed successfully.').send(res);
});

export const newEntryExitLogByStaffId = expressAsyncHandler(async (req, res) => {
  const { office, staffId, timestamp, deviceId, remarks } = req.body;
  const staff = await Staff.find({ office, staffId });
  if (!staff) throw new ApiError(400, 'Validation Failed!', [{ field: 'staffId', message: 'Invalid Staff ID.' }]);

  const date = format(timestamp, 'yyyy-MM-dd'); // Start of the day
  const time = new Date(timestamp);

  // Check if the staff is active and has joined
  if (staff.status !== 'active' || staff.dateOfJoining > time)
    throw new ApiError(400, 'Validation Failed!', [
      { field: 'staffId', message: 'Staff is inactive or has not joined yet.' },
    ]);

  const latestLog = await EntryExitLog.findOne({ staff: staff._id, date }).sort({ slNo: -1 });
  // If no log or the last log is completed (exitTime exists), create a new session
  if (!latestLog || latestLog.exitTime) {
    const newLog = await handleNewEntry({ staff, time, date, latestLog, deviceId, remarks });
    // Calculate attendance for the staff for the current date after creating new log
    autoAttendanceCalculateByStaffId(newLog.office, newLog.staff, newLog.date);
    return new ApiResponse(200, newLog, 'Entry log created successfully.').send(res);
  } else {
    // Otherwise, update the existing session with exit time
    const updatedLog = await handleExit({ staff, time, date, latestLog });
    // Calculate attendance for the staff for the current date after creating new log
    autoAttendanceCalculateByStaffId(updatedLog.office, updatedLog.staff, updatedLog.date);
    return new ApiResponse(200, updatedLog, 'Entry log updated successfully.').send(res);
  }
});

export const addManualEntryExitLog = expressAsyncHandler(async (req, res) => {
  const { staff_id, date, entry_time, exit_time, remarks } = req.body;
  const staffId = staff_id;
  const entryTime = new Date(entry_time);
  const exitTime = new Date(exit_time);

  // Validate entry and exit times
  if (entryTime >= exitTime) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'entryTime',
        message: 'Entry time must be before exit time.',
      },
    ]);
  }
  // Validate staff ID
  const staff = await Staff.findById(staffId);
  if (!staff) {
    throw new ApiError(400, 'Validation Failed!', [{ field: 'staffId', message: 'Invalid Staff ID.' }]);
  }
  // Fetch the most recent log for the staff on the given date
  const lastLog = await EntryExitLog.findOne({ staff: staffId, date }).sort('-slNo');
  let sl_no = 1;
  if (lastLog) {
    // Ensure the new entry_time is after the last exit_time
    if (entryTime <= lastLog.exitTime) {
      throw new ApiError(400, 'Validation Failed!', [
        {
          field: 'entryTime',
          message: `New entry time (${entryTime.toLocaleTimeString()}) must be after the last exit time (${lastLog.exitTime.toLocaleTimeString()}).`,
        },
      ]);
    }
    // Increment sl_no from the last log
    sl_no = lastLog.slNo + 1;
  }
  // Calculate working time (in minutes)
  const workingTime = (exitTime - entryTime) / (1000 * 60);

  const newEntryExitLog = await EntryExitLog.create({
    office: req.admin.office,
    date,
    staff: staff._id,
    slNo: sl_no,
    entryTime,
    exitTime,
    workingTime,
    remarks,
  });

  return new ApiResponse(200, newEntryExitLog, 'Entry log created successfully.').send(res);
});

export const manualEntryLog = expressAsyncHandler(async (req, res) => {
  const { staff_id, date, entry_time, remarks } = req.body;
  // Validate staff ID
  const staff = await Staff.findById(staff_id);
  if (!staff) throw new ApiError(400, 'Validation Failed!', [{ field: 'staffId', message: 'Invalid Staff ID.' }]);

  if (staff.status !== 'active' || staff.dateOfJoining > new Date(date))
    throw new ApiError(400, 'Validation Failed!', [
      { field: 'staffId', message: 'Staff is inactive or has not joined yet.' },
    ]);

  // Fetch the latest log for the staff on the given date
  const latestLog = await EntryExitLog.findOne({ staff: staff_id, date }).sort({ slNo: -1 });

  // Use utility to handle new entry
  const newEntryLog = await handleNewEntry({
    staff,
    time: new Date(entry_time),
    date,
    latestLog,
    manual: true,
    remarks,
  });
  autoAttendanceCalculateByStaffId(newEntryLog.office, newEntryLog.staff, newEntryLog.date);
  return new ApiResponse(200, newEntryLog, 'Entry log created successfully.').send(res);
});

export const editEntryLog = expressAsyncHandler(async (req, res) => {
  const { logId, entryTime, remarks } = req.body;
  const log = await EntryExitLog.findById(logId);
  if (!log) {
    throw new ApiError(404, 'Log entry not found.', [{ field: 'logId', message: 'Invalid log ID.' }]);
  }
  if (!log.manual) {
    throw new ApiError(400, 'Validation Failed!', [{ field: 'logId', message: 'Device Log is not editable.' }]);
  }
  // Ensure entry time matches the specified date
  const entryDate = format(entryTime, 'yyyy-MM-dd');
  if (entryDate !== format(log.date, 'yyyy-MM-dd')) {
    throw new ApiError(400, 'Validation Failed!', [
      { field: 'entryTime', message: 'Entry time must match the specified date.' },
    ]);
  }
  // Prevent edits if the log already has an exit time
  if (log.exitTime) {
    throw new ApiError(400, 'Validation Failed!', [
      { field: 'entryTime', message: 'Cannot edit entry time for a completed log.' },
    ]);
  }

  // Check for conflicts with the previous log
  const previousLog = await EntryExitLog.findOne({
    staff: log.staff, // Use the current staff ID
    date: log.date,
    slNo: { $lt: log.slNo },
    exitTime: { $exists: true },
  }).sort({ slNo: -1 });

  if (previousLog && entryTime <= previousLog.exitTime) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'entryTime',
        message: `Entry time overlaps with the previous log ending at ${previousLog.exitTime.toLocaleTimeString()}.`,
      },
    ]);
  }

  // Check for conflicts with the next log
  const nextLog = await EntryExitLog.findOne({
    staff: log.staff, // Use the current staff ID
    date: log.date,
    slNo: { $gt: log.slNo },
  }).sort({ slNo: 1 });

  if (nextLog && entryTime >= nextLog.entryTime) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'entryTime',
        message: `Entry time overlaps with the next log starting at ${nextLog.entryTime.toLocaleTimeString()}.`,
      },
    ]);
  }

  // Update the log
  log.entryTime = entryTime; // Update entry time
  log.remarks = remarks || log.remarks; // Update remarks if provided
  await log.save(); // Save the changes
  autoAttendanceCalculateByStaffId(log.office, log.staff, log.date);

  return new ApiResponse(200, log, 'Entry log updated successfully.').send(res);
});

export const manualExitLog = expressAsyncHandler(async (req, res) => {
  const { log_id, date, exit_time } = req.body;
  // Fetch the latest incomplete log for the staff on the given date
  const latestLog = await EntryExitLog.findById(log_id);

  if (!latestLog || latestLog.exitTime) {
    throw new ApiError(404, 'Entry log not found or already completed.', [
      { field: 'log_id', message: 'Invalid log ID.' },
    ]);
  }

  // Use utility to handle exit
  const updatedLog = await handleExit({
    staff: latestLog.staff,
    time: new Date(exit_time),
    date,
    latestLog,
  });
  autoAttendanceCalculateByStaffId(updatedLog.office, updatedLog.staff, updatedLog.date);
  return new ApiResponse(200, updatedLog, 'Exit time updated successfully.').send(res);
});

export const getEntryExitLogs = expressAsyncHandler(async (req, res) => {
  const { startDate, endDate, days } = req.query;
  const filters = { office: req.admin.office };

  if (startDate) {
    filters.date = { ...(filters.date || {}), $gte: new Date(startDate) };
  }
  if (endDate) {
    filters.date = { ...(filters.date || {}), $lte: new Date(endDate) };
  }
  if (days) {
    const currentDate = getCurrentDate();
    filters.date = { ...(filters.date || {}), $gte: subDays(new Date(currentDate), parseInt(days)) };
  }

  const entryExitLogs = await EntryExitLog.find(filters).populate('staff', 'fullName staffId').sort('-date -entryTime');
  return new ApiResponse(200, entryExitLogs, 'Entry exit logs fetched successfully.').send(res);
});

export const getEntryExitLogsByMonth = expressAsyncHandler(async (req, res) => {
  let { month, year } = req.query;
  // By default, current month logs only
  const { startDate, endDate } = getLocalMonthBoundariesFormatted();
  let monthFilter = { date: { $gte: startDate, $lte: endDate } };

  month = parseInt(month, 10);
  year = parseInt(year, 10);
  if (!isNaN(month) && !isNaN(year) && month >= 1 && month <= 12) {
    const { startDate, endDate } = getMonthBoundariesFormatted(month, year);
    monthFilter = { date: { $gte: startDate, $lte: endDate } };
  }
  const entryExitLogs = await EntryExitLog.find({ office: req.admin.office, ...monthFilter })
    .populate('staff', 'fullName staffId')
    .sort('-date -entryTime');
  return new ApiResponse(200, entryExitLogs, 'Entry exit logs fetched successfully.').send(res);
});

export const getEntryExitLogsByStaffId = expressAsyncHandler(async (req, res) => {
  const entryExitLogs = await EntryExitLog.find({ staff: req.params.staff_id });
  return new ApiResponse(200, entryExitLogs, 'Entry exit logs fetched successfully.').send(res);
});

export const getEntryExitLogsByDate = expressAsyncHandler(async (req, res) => {
  const entryExitLogs = await EntryExitLog.find({ date: req.params.date });
  return new ApiResponse(200, entryExitLogs, 'Entry exit logs fetched successfully.').send(res);
});

// Helper functions
const handleNewEntry = async ({ staff, time, date, latestLog, deviceId, manual = false, remarks }) => {
  // Validation: Ensure date is not in the future
  if (new Date(date) > new Date()) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'date',
        message: 'Cannot create entry for future dates.',
      },
    ]);
  }

  // Validation: Ensure entry time is on the same date as date field
  const entryDate = format(time, 'yyyy-MM-dd');
  if (entryDate !== date) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'entryTime',
        message: 'Entry time must be on the same date as specified.',
      },
    ]);
  }

  // Validation: Ensure there is no incomplete log for the staff on the given date
  if (latestLog && !latestLog.exitTime) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'entryTime',
        message: `Cannot create a new entry. The previous log (slNo: ${latestLog.slNo}) is incomplete.`,
      },
    ]);
  }

  const lastCompletedLog = await EntryExitLog.findOne({
    staff: staff._id,
    date,
    exitTime: { $exists: true },
  }).sort({ slNo: -1 });

  // Validation: Ensure new entry is after the last completed session's exit time
  if (lastCompletedLog && time <= lastCompletedLog.exitTime) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'entryTime',
        message: `Entry time (${time.toLocaleTimeString()}) overlaps with previous session ending at ${lastCompletedLog.exitTime.toLocaleTimeString()}.`,
      },
    ]);
  }
  const slNo = latestLog ? latestLog.slNo + 1 : 1;

  const entryExitLog = await EntryExitLog.create({
    office: staff.office,
    date,
    staff: staff._id,
    slNo,
    entryTime: time,
    deviceId,
    manual,
    remarks,
  });
  return entryExitLog;
};

const handleExit = async ({ staff, time, date, latestLog }) => {
  // Validation: Ensure entry time is on the same date as date field
  const exitDate = format(time, 'yyyy-MM-dd');
  if (exitDate !== date) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'exitTime',
        message: 'Exit time must be on the same date as specified.',
      },
    ]);
  }

  // Validation: Ensure time is not in the future
  if (new Date(time) > new Date()) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'exitTime',
        message: 'Cannot create entry for future times.',
      },
    ]);
  }

  // Validation: Ensure exit is after entry time of the current session
  if (time <= latestLog.entryTime) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'exitTime',
        message: `Exit time (${time.toLocaleTimeString()}) cannot be before or equal to entry time (${latestLog.entryTime.toLocaleTimeString()}).`,
      },
    ]);
  }
  // Validation: Ensure exit does not overlap with the next session's entry time
  const nextLog = await EntryExitLog.findOne({
    staff: staff._id,
    date,
    slNo: latestLog.slNo + 1,
    entryTime: { $exists: true },
  });

  if (nextLog && time >= nextLog.entryTime) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'exitTime',
        message: `Exit time (${time.toLocaleTimeString()}) overlaps with next session starting at ${nextLog.entryTime.toLocaleTimeString()}.`,
      },
    ]);
  }

  // Update log with exit time and calculate working time
  latestLog.exitTime = time;
  latestLog.workingTime = Math.round((latestLog.exitTime - latestLog.entryTime) / (1000 * 60)); // Working time in minutes
  await latestLog.save();
  return latestLog;
};
