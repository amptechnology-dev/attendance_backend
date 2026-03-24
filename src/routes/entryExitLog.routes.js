import { Router } from 'express';
const router = Router();
import {
  newEntryExitLogsFromAgent,
  addManualEntryExitLog,
  manualEntryLog,
  editEntryLog,
  manualExitLog,
  getEntryExitLogs,
  getEntryExitLogsByMonth,
  getEntryExitLogsByDate,
  getEntryExitLogsByStaffId,
} from '../controllers/entryExitLog.controller.js';
import validateBody from '../middlewares/validator.middleware.js';
import {
  // entryExitLogValidationSchema,
  manualEntryExitLogValidationSchema,
  manualEntryLogValidationSchema,
  manualExitLogValidationSchema,
  updateEntryLogValidationSchema,
} from '../validations/entryExitLog.validator.js';
import { adminAuth, verifyPushAgent } from '../middlewares/auth.middleware.js';

// router.route('/new').post(validateBody(entryExitLogValidationSchema), newEntryExitLogByStaffId);
router.route('/new/agent').post(verifyPushAgent, newEntryExitLogsFromAgent);
router.route('/new/manual').post(adminAuth, validateBody(manualEntryExitLogValidationSchema), addManualEntryExitLog);
router.route('/new/manual/entry').post(adminAuth, validateBody(manualEntryLogValidationSchema), manualEntryLog);
router.route('/edit/entry').put(adminAuth, validateBody(updateEntryLogValidationSchema), editEntryLog);
router.route('/new/manual/exit').post(adminAuth, validateBody(manualExitLogValidationSchema), manualExitLog);
router.route('/get').get(adminAuth, getEntryExitLogs);
router.route('/get-by-month').get(adminAuth, getEntryExitLogsByMonth);
router.route('/get-by-date/:date').get(adminAuth, getEntryExitLogsByDate);
router.route('/get-by-staff/:staff_id').get(adminAuth, getEntryExitLogsByStaffId);

export default router;
