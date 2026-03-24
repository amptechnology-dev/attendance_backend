import { Router } from 'express';
const router = Router();
import { hasPermission } from '../../middlewares/auth.middleware.js';
import { permissions } from '../../config/constants.js';
import { dutyTimingValidationSchema } from '../../validations/dutyTiming.validation.js';
import validateBody from '../../middlewares/validator.middleware.js';

import { createDutyTiming, updateDutyTiming, getDutyTiming } from '../../controllers/admin/dutyTiming.controller.js';
router.route('/create').post(hasPermission(permissions.MANAGE_DUTY_TIMING), createDutyTiming);
router
  .route('/update')
  .put(hasPermission(permissions.MANAGE_DUTY_TIMING), validateBody(dutyTimingValidationSchema), updateDutyTiming);
router.route('/get').get(hasPermission(permissions.VIEW_DUTY_TIMING), getDutyTiming);

export default router;
