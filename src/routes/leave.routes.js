import { Router } from 'express';
import {
  newLeaveApplication,
  deleteLeaveApplication,
  acceptLeaveApplication,
  rejectLeaveApplication,
  getAllLeaves,
  getAllUserLeaves,
  getLeaveApplicationCountByDepartment,
} from '../controllers/leave.controller.js';
import { adminAuth, staffAuth, hasPermission } from '../middlewares/auth.middleware.js';
import validateBody from '../middlewares/validator.middleware.js';
import { leaveApplicationValidationSchema } from '../validations/leave.validation.js';
import { upload } from '../utils/uploadAndCompressImage.js';
import { permissions } from '../config/constants.js';

const router = Router();

router
  .route('/new/staff')
  .post(
    staffAuth,
    upload.single('document'),
    validateBody(leaveApplicationValidationSchema, true),
    newLeaveApplication
  );
router.route('/get/staff').get(staffAuth, getAllUserLeaves);
router.route('/delete/staff').delete(staffAuth, deleteLeaveApplication);

router.use(adminAuth);
router
  .route('/new')
  .post(
    hasPermission(permissions.APPLY_LEAVES),
    upload.single('document'),
    validateBody(leaveApplicationValidationSchema, true),
    newLeaveApplication
  );
router.route('/delete').delete(hasPermission(permissions.APPLY_LEAVES), deleteLeaveApplication);
router.route('/accept').patch(hasPermission(permissions.APPROVE_LEAVES), acceptLeaveApplication);
router.route('/reject').patch(hasPermission(permissions.APPROVE_LEAVES), rejectLeaveApplication);
router.route('/get-all').get(hasPermission(permissions.VIEW_LEAVES), getAllLeaves);
router.route('/get-count-by-department').get(getLeaveApplicationCountByDepartment);

export default router;
