import { Router } from 'express';
import {
  createStaff,
  updateStaff,
  patchStaffStatus,
  getStaffs,
  getStaffById,
  deleteStaff,
  changePassword,
  updateProfilePicture,
  getStaffsWithAdvanceSalary,
} from '../../controllers/staff.controller.js';
import {
  staffValidationSchema,
  updateStaffValidationSchema,
  changeStaffStatusSchema,
} from '../../validations/staff.validator.js';
import validateBody from '../../middlewares/validator.middleware.js';
import profilePictureUpload from '../../utils/profilePictureUploader.js';

const router = Router();
router.route('/create').post(validateBody(staffValidationSchema), createStaff);
router.route('/update/:id').put(validateBody(updateStaffValidationSchema, true), updateStaff);
router.route('/change-status/:id').patch(validateBody(changeStaffStatusSchema, true), patchStaffStatus);
router.route('/delete/:id').delete(deleteStaff);
router.route('/get').get(getStaffs);
router.route('/get/:id').get(getStaffById);
router.route('/get-with-advance-salary').get(getStaffsWithAdvanceSalary);
router.route('/change-password/:id').put(changePassword);
router.route('/update-photo/:id').put(profilePictureUpload.single('photo'), updateProfilePicture);

export default router;
