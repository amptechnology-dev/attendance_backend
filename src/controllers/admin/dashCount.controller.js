import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../../utils/responseHandler.js';
import { Staff } from '../../models/staff.model.js';
import { Attendance } from '../../models/attendance.model.js';
import { Leave } from '../../models/leave.model.js';

export const dashboradCounter = expressAsyncHandler(async (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  //Total staff entered today
  const totalPresentStaffs = await Attendance.countDocuments({
    office: req.admin.office,
    date: today,
    status: { $in: ['present', 'full-day', 'half-day'] },
  });
  const totalStaffs = await Staff.countDocuments({ office: req.admin.office, status: 'active' });
  //Total staffs on leave
  const totalStaffsOnLeave = await Leave.countDocuments({
    office: req.admin.office,
    type: { $ne: 'holidayLeave' },
    dateFrom: { $gte: today },
    dateTo: { $lte: today },
    status: 'approved',
  });

  //Total Pending Leave
  const totalPendingLeaves = await Leave.countDocuments({
    office: req.admin.office,
    type: { $ne: 'holidayLeave' },
    status: 'applied',
  });

  return new ApiResponse(
    200,
    { totalPresentStaffs, totalStaffs, totalStaffsOnLeave, totalPendingLeaves },
    'Dashboard counters fetched successfully.'
  ).send(res);
});
