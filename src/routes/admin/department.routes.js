import { Router } from 'express';
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartments,
} from '../../controllers/admin/department.controller.js';

const router = Router();
router.route('/create').post(createDepartment);
router.route('/update').put(updateDepartment);
router.route('/delete/:id').delete(deleteDepartment);
router.route('/get').get(getDepartments);

export default router;
