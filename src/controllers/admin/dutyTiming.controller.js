import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../../utils/responseHandler.js';
import { DutyTiming } from '../../models/dutyTiming.model.js';
import { parse, isBefore } from 'date-fns';

export const createDutyTiming = expressAsyncHandler(async (req, res) => {
  const {
    department,
    startTime,
    // entryTime,
    firstHalfEnd,
    secondHalfStart,
    endTime,
    halfDayAllowed,
    lateAllowed,
    lateEntryTime,
    paidLeave,
  } = req.body;

  if (!department || !startTime || !firstHalfEnd || !secondHalfStart || !endTime) {
    throw new ApiError(400, 'Please provide all required fields.');
  }
  const existingDutyTiming = await DutyTiming.findOne({ office: req.admin.office, department });
  if (existingDutyTiming) {
    throw new ApiError(400, 'Duty Timing already exists for this department.');
  }

  const parseTime = (timeStr) => parse(timeStr, 'HH:mm', new Date());
  // Parse time strings (falling back to existing values)
  const parsed = {
    startTime: parseTime(startTime || existingDutyTiming.startTime),
    // entryTime: parseTime(entryTime || existingDutyTiming.entryTime),
    firstHalfEnd: parseTime(firstHalfEnd || existingDutyTiming.firstHalfEnd),
    secondHalfStart: parseTime(secondHalfStart || existingDutyTiming.secondHalfStart),
    endTime: parseTime(endTime || existingDutyTiming.endTime),
  };

  if (isBefore(parsed.firstHalfEnd, parsed.startTime)) {
    throw new ApiError(400, 'Validation Failed!', [
      { feild: 'firstHalfEnd', message: 'First Half End time cannot be before Start Time' },
    ]);
  }
  if (isBefore(parsed.secondHalfStart, parsed.firstHalfEnd)) {
    throw new ApiError(400, 'Validation Failed!', [
      { feild: 'secondHalfStart', message: 'Second Half Start time cannot be before First Half End time' },
    ]);
  }
  if (isBefore(parsed.endTime, parsed.secondHalfStart)) {
    throw new ApiError(400, 'Validation Failed!', [
      { feild: 'endTime', message: 'End Time cannot be before Second Half Start time' },
    ]);
  }

  try {
    const dutyTiming = await DutyTiming.create({
      office: req.admin.office,
      department,
      startTime,
      entryTime: startTime,
      firstHalfEnd,
      secondHalfStart,
      endTime,
      halfDayAllowed,
      lateAllowed,
      lateEntryTime,
      paidLeave,
    });
    return new ApiResponse(201, dutyTiming, 'Duty Timing created successfully.').send(res);
  } catch (error) {
    return new ApiError(500, error.message, error.errors).send(res);
  }
});

export const updateDutyTiming = expressAsyncHandler(async (req, res) => {
  const {
    id,
    startTime,
    entryTime,
    firstHalfEnd,
    secondHalfStart,
    endTime,
    halfDayAllowed,
    lateAllowed,
    lateEntryTime,
    paidLeave,
  } = req.body;
  const existingDutyTiming = await DutyTiming.findById(id);
  if (!existingDutyTiming) {
    throw new ApiError(400, 'Duty Timing does not exists.');
  }

  const parseTime = (timeStr) => parse(timeStr, 'HH:mm', new Date());
  // Parse time strings (falling back to existing values)
  const parsed = {
    startTime: parseTime(startTime || existingDutyTiming.startTime),
    entryTime: parseTime(entryTime || existingDutyTiming.entryTime),
    firstHalfEnd: parseTime(firstHalfEnd || existingDutyTiming.firstHalfEnd),
    secondHalfStart: parseTime(secondHalfStart || existingDutyTiming.secondHalfStart),
    endTime: parseTime(endTime || existingDutyTiming.endTime),
  };

  if (isBefore(parsed.firstHalfEnd, parsed.startTime)) {
    throw new ApiError(400, 'Validation Failed!', [
      { feild: 'firstHalfEnd', message: 'First Half End time cannot be before Start Time' },
    ]);
  }
  if (isBefore(parsed.secondHalfStart, parsed.firstHalfEnd)) {
    throw new ApiError(400, 'Validation Failed!', [
      { feild: 'secondHalfStart', message: 'Second Half Start time cannot be before First Half End time' },
    ]);
  }
  if (isBefore(parsed.endTime, parsed.secondHalfStart)) {
    throw new ApiError(400, 'Validation Failed!', [
      { feild: 'endTime', message: 'End Time cannot be before Second Half Start time' },
    ]);
  }

  // Apply updates only if provided
  Object.assign(existingDutyTiming, {
    ...(startTime && { startTime }),
    ...(entryTime && { entryTime }),
    ...(firstHalfEnd && { firstHalfEnd }),
    ...(secondHalfStart && { secondHalfStart }),
    ...(endTime && { endTime }),
    ...(lateEntryTime && { lateEntryTime }),
    ...(halfDayAllowed && { halfDayAllowed }),
    ...(lateAllowed && { lateAllowed }),
    ...(paidLeave && { paidLeave }),
  });
  const updatedDutyTiming = await existingDutyTiming.save();
  return new ApiResponse(200, updatedDutyTiming, 'Duty Timing updated successfully.').send(res);
});

export const getDutyTiming = expressAsyncHandler(async (req, res) => {
  const dutyTiming = await DutyTiming.find({ office: req.admin.office });
  if (!dutyTiming) {
    throw new ApiError(404, 'Duty Timing not found.');
  }
  return new ApiResponse(200, dutyTiming, 'Duty Timing fetched successfully.').send(res);
});
