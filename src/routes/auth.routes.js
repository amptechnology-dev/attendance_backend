import { Router } from 'express';
import {
  adminLogin,
  adminLogout,
  resetAdminPassword,
  staffLogin,
  refreshStaffTokens,
  sendOTPAtMobile,
  resetStaffPassword,
} from '../controllers/auth.controller.js';
import { adminAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.route('/admin').post(adminLogin);
router.route('/admin/logout').post(adminLogout);
router.route('/admin/reset-password').post(adminAuth, resetAdminPassword);
router.route('/staff').post(staffLogin);
router.route('/staff/refresh-token').post(refreshStaffTokens);
router.route('/staff/forget-password').post(sendOTPAtMobile);
router.route('/staff/reset-password').post(resetStaffPassword);

export default router;
