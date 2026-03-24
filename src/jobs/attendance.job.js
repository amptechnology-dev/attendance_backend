import { Staff } from '../models/staff.model.js';
import { autoAttendanceCalculateByStaffId } from '../services/attendance.service.js';
import logger from '../config/logger.js';
import { getCurrentDate } from '../utils/dateTime.utils.js';

export default async function Job() {
  try {
    const today = getCurrentDate();
    const allStaff = await Staff.find().select('_id office');
    for (const staff of allStaff) {
      await autoAttendanceCalculateByStaffId(staff.office, staff._id, today);
    }
    logger.info('Auto Attendance Calculation Job completed!');
  } catch (error) {
    logger.error('Error in Auto Attendance Calculation Job:', error);
  }
}
