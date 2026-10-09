import expressAsyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import { ApiResponse, ApiError } from '../utils/responseHandler.js';
import { Admin } from '../models/admin.model.js';
import { Office } from '../models/office.model.js';

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const assertValidId = (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, 'Invalid admin id.');
  }
};

// GET /super-admin/admins?page=1&limit=10&search=abc
export const getAdmins = expressAsyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
  const search = req.query.search?.toString().trim();

  const filter = {};
  if (search) {
    const safe = escapeRegex(search);
    filter.$or = [
      { username: { $regex: safe, $options: 'i' } },
      { mobile: { $regex: safe, $options: 'i' } },
    ];
  }

  const [admins, total] = await Promise.all([
    Admin.find(filter)
      .select('-password -otp -otpExpires')
      .populate('office', 'name')
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Admin.countDocuments(filter),
  ]);

  return new ApiResponse(
    200,
    {
      admins,
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    },
    'Admins retrieved successfully.'
  ).send(res);
});

// POST /super-admin/admins
export const createAdmin = expressAsyncHandler(async (req, res) => {
  const { office, username, password, mobile } = req.body;

  if (!office || !username?.trim() || !password || !mobile?.trim()) {
    throw new ApiError(400, 'office, username, password and mobile are required.');
  }
  if (!mongoose.isValidObjectId(office)) {
    throw new ApiError(400, 'Invalid office id.');
  }

  const officeExists = await Office.exists({ _id: office });
  if (!officeExists) throw new ApiError(404, 'Office not found.');

  if (await Admin.exists({ username: username.trim() })) {
    throw new ApiError(400, 'Username already exists.');
  }
  if (await Admin.exists({ mobile: mobile.trim() })) {
    throw new ApiError(400, 'Mobile number already exists.');
  }

  const admin = await Admin.create({
    office,
    username: username.trim(),
    password,
    mobile: mobile.trim(),
  });

  const created = await Admin.findById(admin._id).select('-password').populate('office', 'name');
  return new ApiResponse(201, created, 'Admin created successfully.').send(res);
});

// PUT /super-admin/admins/:id
export const updateAdmin = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  assertValidId(id);

  const { office, username, password, mobile } = req.body;

  const admin = await Admin.findById(id);
  if (!admin) throw new ApiError(404, 'Admin not found.');

  if (office && String(office) !== String(admin.office)) {
    if (!mongoose.isValidObjectId(office)) throw new ApiError(400, 'Invalid office id.');
    if (!(await Office.exists({ _id: office }))) throw new ApiError(404, 'Office not found.');
    admin.office = office;
  }

  if (username && username.trim() !== admin.username) {
    const taken = await Admin.exists({ username: username.trim(), _id: { $ne: id } });
    if (taken) throw new ApiError(400, 'Username already exists.');
    admin.username = username.trim();
  }

  if (mobile && mobile.trim() !== admin.mobile) {
    const taken = await Admin.exists({ mobile: mobile.trim(), _id: { $ne: id } });
    if (taken) throw new ApiError(400, 'Mobile number already exists.');
    admin.mobile = mobile.trim();
  }

  // password optional: khali thakle change hobe na
  if (password) {
    admin.password = password;
  }

  // save() use korchi jate password hash er pre-save hook cholte pare
  await admin.save();

  const updated = await Admin.findById(id).select('-password').populate('office', 'name');
  return new ApiResponse(200, updated, 'Admin updated successfully.').send(res);
});

// DELETE /super-admin/admins/:id
export const deleteAdmin = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  assertValidId(id);

  const admin = await Admin.findByIdAndDelete(id);
  if (!admin) throw new ApiError(404, 'Admin not found.');

  return new ApiResponse(200, null, 'Admin deleted successfully.').send(res);
});