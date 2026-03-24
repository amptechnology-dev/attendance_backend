import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../../utils/responseHandler.js';
import { Department } from '../../models/department.model.js';
import { Staff } from '../../models/staff.model.js';

export const createDepartment = expressAsyncHandler(async (req, res) => {
  const { name, head, supervisor } = req.body;

  if (!name.trim()) {
    throw new ApiError(400, 'Department name is required.');
  }
  if (await Department.findOne({ name })) {
    throw new ApiError(400, 'Department already exists.');
  }
  if (head && !(await Staff.findById(head))) {
    throw new ApiError(400, 'Invalid Department Head User ID.');
  }
  if (supervisor && !(await Staff.findById(supervisor))) {
    throw new ApiError(400, 'Invalid Supervisor User ID.');
  }
  const department = await Department.create({ office: req.admin.office, name, head, supervisor });

  return new ApiResponse(201, department, 'Department created successfully.').send(res);
});

export const updateDepartment = expressAsyncHandler(async (req, res) => {
  try {
    const { id, name, head, supervisor } = req.body;
    const department = await Department.findOne({ _id: id, office: req.admin.office });

    if (!name.trim()) {
      throw new ApiError(400, 'Department name is required.');
    }
    if (!department) {
      throw new ApiError(400, 'Invalid Department ID.');
    }

    // Validation: Prevents updating department name if staff exsits
    const existingStaff = await Staff.findOne({ department: id });
    if (existingStaff && department.name !== name) {
      throw new ApiError(400, 'Cannot update department name if staff exsits.');
    }

    if (name && (await Department.findOne({ name }))) {
      throw new ApiError(400, 'Department already exists.');
    }
    if (head && !(await Staff.findById(head))) {
      throw new ApiError(400, 'Invalid Department Head User ID.');
    }
    if (supervisor && !(await Staff.findById(supervisor))) {
      throw new ApiError(400, 'Invalid Supervisor User ID.');
    }

    const updatedDepartment = await Department.findByIdAndUpdate(id, { name, head, supervisor }, { new: true });
    return new ApiResponse(200, updatedDepartment, 'Department updated successfully.').send(res);
  } catch (error) {
    throw new ApiError(500, error.message);
  }
});

export const deleteDepartment = expressAsyncHandler(async (req, res) => {
  const department = await Department.findOne({ _id: req.params.id, office: req.admin.office });
  if (!department) {
    throw new ApiError(404, 'Department not found.');
  }

  // Validation: Prevents deleting department name if staff exsits
  const existingStaff = await Staff.findOne({ department: department._id });
  if (existingStaff) {
    throw new ApiError(400, 'Cannot delete department if staff exsits.');
  }

  await department.deleteOne();
  return new ApiResponse(200, department, 'Department deleted successfully.').send(res);
});

export const getDepartments = expressAsyncHandler(async (req, res) => {
  const departments = await Department.find({ office: req.admin.office })
    .populate('office', 'name _id')
    .sort({ name: 1 });
  return new ApiResponse(200, departments, 'Departments fetched successfully.').send(res);
});
