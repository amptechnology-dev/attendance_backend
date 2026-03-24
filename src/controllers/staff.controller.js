import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { Staff } from '../models/staff.model.js';
import { Department } from '../models/department.model.js';
import { validateUniqueFields } from '../validations/validateUniqueFields.js';
import bodyCleaner from '../utils/bodyCleaner.js';
import { saveAdvanceSalary } from '../services/salary.service.js';
import { generateRandomPassword } from '../utils/randomStringGenarator.js';
import logger from '../config/logger.js';
import { permissions } from '../config/constants.js';
import { uploadFileToR2 } from '../utils/uploadToR2.js';
import path from 'path';
import mongoose from 'mongoose';
import { Attendance } from '../models/attendance.model.js';
import { EntryExitLog } from '../models/entryExitLog.model.js';
import { Leave } from '../models/leave.model.js';
import { Salary } from '../models/salary.model.js';

export const createStaff = expressAsyncHandler(async (req, res) => {
  const { department, mobile, email, pfNo, esiNo, panNo, aadhaarNo } = req.body;

  //Check valid department
  if (!department && !(await Department.findById(department))) {
    throw new ApiError(400, 'Validation Failed!', [{ field: 'department', message: 'Invalid Department ID.' }]);
  }
  //Check unique feilds
  const duplicateFound = await validateUniqueFields(Staff, { email, mobile, pfNo, esiNo, panNo, aadhaarNo });
  if (duplicateFound) {
    throw new ApiError(400, 'Validation Failed!', [
      { field: duplicateFound, message: `${duplicateFound} already exists.` },
    ]);
  }

  let randomStaffId;
  let isUnique = false;
  // Ensure uniqueness of the 6-digit ID
  while (!isUnique) {
    randomStaffId = Math.floor(100000 + Math.random() * 900000); // Generate a 6-digit random number
    const existingStaff = await Staff.findOne({ staffId: randomStaffId });
    if (!existingStaff) {
      isUnique = true;
      req.body.staffId = randomStaffId;
    }
  }

  try {
    const cleanedBody = bodyCleaner(req.body);
    cleanedBody.office = req.admin.office;
    cleanedBody.advancedSalary = undefined;
    cleanedBody.password = generateRandomPassword();
    // Create new staff document
    const staff = await Staff.create(cleanedBody);

    // Save advance salary
    if (req.body.advanceRemainingAmount) {
      const { advanceTotalAmount, advanceRemainingAmount, advanceRemainingMonths, advanceRemarks } = req.body;
      const advanceSalary = await saveAdvanceSalary(
        staff._id,
        advanceTotalAmount,
        advanceRemainingAmount,
        advanceRemainingMonths,
        advanceRemarks
      );
      staff.advanceSalary = advanceSalary;
    }

    const data = { ...staff.toObject(), password: cleanedBody.password };
    return new ApiResponse(201, data, 'Staff created successfully.').send(res);
  } catch (error) {
    throw new ApiError(500, error.message);
  }
});

export const updateStaff = expressAsyncHandler(async (req, res) => {
  const updates = req.body;
  const { id } = req.params;

  // Remove undefined fields from updates (prevents overwriting with undefined)
  Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);

  // Check if staff exists
  const staffExists = await Staff.exists({ _id: id });
  if (!staffExists) {
    throw new ApiError(404, 'Staff not found');
  }
  // Validate department if updated
  if (updates.department && !(await Department.exists({ _id: updates.department }))) {
    throw new ApiError(400, 'Validation Failed!', [{ field: 'department', message: 'Invalid Department ID.' }]);
  }

  // Check for unique field conflicts
  const uniqueFields = ['mobile', 'pfNo', 'esiNo', 'panNo', 'aadhaarNo'];
  const uniqueUpdates = Object.fromEntries(Object.entries(updates).filter(([key]) => uniqueFields.includes(key)));

  if (Object.keys(uniqueUpdates).length > 0) {
    const duplicateField = await validateUniqueFields(Staff, uniqueUpdates);
    if (duplicateField) {
      throw new ApiError(400, 'Validation Failed!', [
        { field: duplicateField, message: `${duplicateField} already exists.` },
      ]);
    }
  }

  // Perform the update
  const updatedStaff = await Staff.findByIdAndUpdate(id, updates, { new: true });
  return new ApiResponse(200, updatedStaff, 'Staff updated successfully.').send(res);
});

export const deleteStaff = expressAsyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const staffId = req.params.id;
  const staff = await Staff.findOne({ _id: staffId, office: req.admin.office });
  if (!staff) {
    throw new ApiError(404, 'Staff not found.');
  }
  await staff.deleteOne();
  await Attendance.deleteMany({ staffId });
  await EntryExitLog.deleteMany({ staff: staffId });
  await Leave.deleteMany({ staff: staffId });
  await Salary.deleteMany({ staff: staffId });
  await session.commitTransaction();
  await session.endSession();
  return new ApiResponse(200, staff, 'Staff deleted successfully.').send(res);
});

export const patchStaffStatus = expressAsyncHandler(async (req, res) => {
  const updatedStaff = await Staff.findOneAndUpdate(
    { _id: req.params.id, office: req.admin.office },
    { $set: { status: req.body.status } },
    { new: true }
  );
  return new ApiResponse(200, updatedStaff, 'Staff status updated successfully.').send(res);
});

export const getStaffs = expressAsyncHandler(async (req, res) => {
  const { status } = req.query;
  const user = req.admin;
  const hasFullAccess =
    user.role?.permissions?.includes(permissions.ALL) || user.role?.permissions?.includes(permissions.VIEW_ALL_STAFFS);

  const staffs = await Staff.find({
    office: user.office,
    ...(status && { status }),
    ...(hasFullAccess ? {} : { department: user.department }),
  })
    .populate('department', 'name')
    .sort({ fullName: 1 });
  return new ApiResponse(200, staffs, 'Staffs fetched successfully.').send(res);
});

export const getStaffById = expressAsyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id).populate('department', 'name');
  if (!staff) {
    throw new ApiError(404, 'Staff not found.');
  }
  return new ApiResponse(200, staff, 'Staff fetched successfully.').send(res);
});

export const getStaffsWithAdvanceSalary = expressAsyncHandler(async (req, res) => {
  const staffs = await Staff.find({ office: req.admin.office, 'advanceSalary.remainingAmount': { $gt: 0 } })
    .select('advanceSalary fullName staffId')
    .sort('fullName');
  return new ApiResponse(200, staffs, 'Staffs fetched successfully.').send(res);
});

export const changePassword = expressAsyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) {
    throw new ApiError(400, 'New Password is required.');
  }
  if (newPassword.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters long.');
  }
  const staff = await Staff.findById(req.params.id).select('+password');
  if (!staff) {
    throw new ApiError(404, 'Staff not found.');
  }
  staff.password = newPassword;
  await staff.save();
  return new ApiResponse(200, [{ id: staff._id, fullName: staff.fullName }], 'Password changed successfully.').send(
    res
  );
});

export const updateProfilePicture = expressAsyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) {
    throw new ApiError(404, 'Staff not found.');
  }
  if (req.file) {
    const file = req.file;
    const key = `attendance/profile_picture/${staff._id}${path.extname(file.originalname)}`;
    const fileUrl = await uploadFileToR2(file.buffer, key, file.mimetype);
    staff.photo = fileUrl;
    await staff.save();

    return new ApiResponse(
      200,
      [{ id: staff._id, fullName: staff.fullName, photo: staff.photo }],
      'Profile picture updated successfully.'
    ).send(res);
  } else {
    throw new ApiError(400, 'Profile picture is required.');
  }
});

export const getProfile = expressAsyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.staff._id);
  return new ApiResponse(200, staff, 'Profile fetched successfully.').send(res);
});
