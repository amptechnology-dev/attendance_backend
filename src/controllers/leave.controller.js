import { subYears } from 'date-fns';
import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { Leave } from '../models/leave.model.js';
import { Staff } from '../models/staff.model.js';
import { permissions } from '../config/constants.js';
import { compressImage } from '../utils/uploadAndCompressImage.js';
import { uploadFileToR2 } from '../utils/uploadToR2.js';
import path from 'path';
import { deleteFileFromR2 } from '../utils/deleteFromR2.js';

export const newLeaveApplication = expressAsyncHandler(async (req, res) => {
  const { staff, dateFrom, dateTo, type, reason, remarks } = req.body;
  const staffObj = await Staff.findById(staff || req.staff?._id);
  if (!staffObj) {
    throw new ApiError(400, 'Invalid Staff ID.');
  }

  const noOfDays = (new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24) + 1;
  const existingLeave = await Leave.findOne({
    office: staffObj.office,
    staff: staffObj.id,
    dateFrom,
    dateTo,
  });
  if (existingLeave) {
    throw new ApiError(400, 'Validation Failed!', [
      {
        field: 'dateFrom',
        message: 'You already have a leave application for the given date.',
      },
    ]);
  }

  let fileUrl = undefined;
  if (req.file) {
    const { buffer, mimetype } = await compressImage(req.file.buffer);
    const key = `attendance/leave/${Date.now()}${path.extname(req.file.originalname)}`;
    fileUrl = await uploadFileToR2(buffer, key, mimetype);
  }

  const leave = await Leave.create({
    office: staffObj.office,
    staff: staffObj.id,
    dateFrom,
    dateTo,
    type,
    noOfDays,
    reason,
    document: fileUrl,
    remarks,
  });

  return new ApiResponse(201, leave, 'Leave application created successfully.').send(res);
});

export const deleteLeaveApplication = expressAsyncHandler(async (req, res) => {
  const { id } = req.body;
  const leave = await Leave.findById(id);
  if (!leave) throw new ApiError(404, 'Not found!', [{ field: 'id', message: 'Leave not found.' }]);
  if (leave.status !== 'applied' || leave.type === 'holidayLeave') {
    throw new ApiError(400, 'Leave already processed.', [{ field: 'id', message: 'Leave already processed.' }]);
  }
  await leave.deleteOne();
  leave.document && deleteFileFromR2(leave.document);
  return new ApiResponse(200, leave, 'Leave application withdrawn successfully.').send(res);
});

export const acceptLeaveApplication = expressAsyncHandler(async (req, res) => {
  const { id, remarks, isPaid } = req.body;
  const leave = await Leave.findById(id);
  if (!leave) {
    throw new ApiError(404, 'Not found!', [{ field: 'id', message: 'Leave not found.' }]);
  }

  if (isPaid == 'true') {
    // Check if staff has enough paid leaves
    const staff = await Staff.findById(leave.staff);
    if (staff.allowedPaidLeaves < leave.noOfDays) {
      throw new ApiError(400, 'Not enough paid leaves!', [
        {
          field: 'staff',
          message: 'Staff does not have enough paid leaves balance.',
        },
      ]);
    }
    // Update staff's allowed paid leaves
    staff.allowedPaidLeaves -= leave.noOfDays;
    await staff.save();
    leave.isPaid = true;
  }

  leave.status = 'approved';
  leave.remarks = remarks || leave.remarks;
  await leave.save();
  return new ApiResponse(200, leave, 'Leave application approved successfully.').send(res);
});

export const rejectLeaveApplication = expressAsyncHandler(async (req, res) => {
  const { id, remarks } = req.body;
  const leave = await Leave.findById(id);
  if (!leave) {
    throw new ApiError(404, 'Leave not found or already processed.');
  }
  leave.status = 'rejected';
  leave.remarks = remarks || leave.remarks;
  await leave.save();
  return new ApiResponse(200, leave, 'Leave application rejected successfully.').send(res);
});

export const getAllUserLeaves = expressAsyncHandler(async (req, res) => {
  const { status, type } = req.query;
  const leaveApplications = await Leave.find({
    staff: req.staff._id,
    ...(status && { status }),
    ...(type && { type }),
  })
    .populate('staff', 'fullName staffId allowedPaidLeaves')
    .sort('-dateFrom');
  return new ApiResponse(200, leaveApplications, 'Leaves fetched successfully.').send(res);
});

export const getAllLeaves = expressAsyncHandler(async (req, res) => {
  const user = req.admin;
  const { status, type } = req.query;

  let staffMatchFilter = {};
  const hasFullAccess =
    user.role?.permissions?.includes(permissions.ALL) ||
    user.role?.permissions?.includes(permissions.VIEW_ALL_ATTENDANCE);

  if (!hasFullAccess) {
    const allStaffs = await Staff.find({
      office: user.office,
      department: user.department,
    }).select('_id');

    const staffIds = allStaffs.map((s) => s._id);
    staffMatchFilter.staff = { $in: staffIds };
  }

  const leaveApplications = await Leave.find({
    office: user.office,
    dateFrom: { $gte: subYears(new Date(), 1) }, //NOTE: Only fetch leaves for last 1 year
    ...(status && { status }),
    ...(type && { type }),
    ...staffMatchFilter,
  })
    .populate('staff', 'fullName staffId allowedPaidLeaves department')
    .sort('-dateFrom');
  return new ApiResponse(200, leaveApplications, 'Leaves fetched successfully.').send(res);
});

export const getLeaveApplicationCountByDepartment = expressAsyncHandler(async (req, res) => {
  const { department, dateFrom, dateTo, status, type } = req.query;
  const staffs = await Staff.find({
    office: req.admin.office,
    department,
  })
    .select('_id')
    .lean();

  const staffIds = staffs.map((s) => s._id);
  const count = await Leave.countDocuments({
    office: req.admin.office,
    staff: { $in: staffIds },
    dateFrom: { $gte: dateFrom },
    dateTo: { $lte: dateTo },
    ...(status && { status }),
    ...(type && { type }),
  });
  return new ApiResponse(200, count, 'Leave count fetched successfully.').send(res);
});
