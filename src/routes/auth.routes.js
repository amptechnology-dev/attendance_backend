import { Router } from 'express';
import {
  getAllOffices,
  registerAdmin,
  adminLogin,
  adminLogout,
  resetAdminPassword,
  staffLogin,
  refreshStaffTokens,
  sendOTPAtMobile,
  resetStaffPassword,
  superAdminLogin,
  superAdminLogout,
} from '../controllers/auth.controller.js';
import { adminAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.route('/admin/offices').get(getAllOffices);
router.route('/admin/register').post(registerAdmin);
router.route('/admin').post(adminLogin);
router.route('/admin/logout').post(adminLogout);
router.route('/admin/reset-password').post(adminAuth, resetAdminPassword);

router.route('/super-admin').post(superAdminLogin);
router.route('/super-admin/logout').post(superAdminLogout);

router.route('/staff').post(staffLogin);
router.route('/staff/refresh-token').post(refreshStaffTokens);
router.route('/staff/forget-password').post(sendOTPAtMobile);
router.route('/staff/reset-password').post(resetStaffPassword);

export default router;