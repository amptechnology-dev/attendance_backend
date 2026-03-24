import { Router } from 'express';
const router = Router();
import { me } from '../../controllers/admin/profile.controller.js';

router.route('/info').get(me);

export default router;
