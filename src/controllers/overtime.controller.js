import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { getOvertimeReport, applyOvertime } from '../services/overtime.service.js';

export const getOvertimeReportByMonth = expressAsyncHandler(async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) {
    throw new ApiError(400, 'Bad Request', 'month and year are required.');
  }
  const data = await getOvertimeReport(req.admin.office, parseInt(month), parseInt(year));
  return new ApiResponse(200, data, 'Overtime report fetched successfully.').send(res);
});

export const applyOvertimeForStaff = expressAsyncHandler(async (req, res) => {
  const { month, year, selections } = req.body;
  if (!month || !year || !Array.isArray(selections) || !selections.length) {
    throw new ApiError(400, 'Bad Request', 'month, year and selections[] are required.');
  }
  const data = await applyOvertime(req.admin.office, parseInt(month), parseInt(year), req.admin._id, selections);
  return new ApiResponse(200, data, 'Overtime applied successfully.').send(res);
});