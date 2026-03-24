import cron from 'node-cron';
import autoAttendanceJob from './attendance.job.js';
import logger from '../config/logger.js';

// Schedule autoAttendanceJob to run every night at 11:59 PM
const scheduleJobs = () => {
  cron.schedule('55 23 * * *', async () => {
    logger.info('Running scheduled Auto Attendance Calculation Job...');
    await autoAttendanceJob();
  });

  logger.info('All cron jobs scheduled.');
};

export default scheduleJobs;
