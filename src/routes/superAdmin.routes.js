import { Router } from 'express';
import { superAdminAuth } from '../middlewares/auth.middleware.js';
import {
  getAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
} from '../controllers/superAdmin.controller.js';

const router = Router();

router.use(superAdminAuth);

router.route('/admins').get(getAdmins).post(createAdmin);
router.route('/admins/:id').put(updateAdmin).delete(deleteAdmin);

export default router;