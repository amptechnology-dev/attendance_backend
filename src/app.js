import express from 'express';
import { configDotenv } from 'dotenv';
import errorHandler from './middlewares/errorHandler.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import scheduleJobs from './jobs/cronJobs.js';

configDotenv();
const app = express();

// Middlewares
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(express.static('public'));
app.use(cookieParser(process.env.COOKIE_SECRET));
scheduleJobs(); // Schedule cron jobs

//routes import
import publicRouter from './routes/public.routes.js';
import authRouter from './routes/auth.routes.js';
import adminRouter from './routes/admin.routes.js';
import entryExitLogRouter from './routes/entryExitLog.routes.js';
import attendanceRouter from './routes/attendance.routes.js';
import salaryRouter from './routes/salary.routes.js';
import staffRouter from './routes/staff.routes.js';
import logsRouter from './routes/admin/logs.routes.js';

//routes declaration
app.use('/api', publicRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/entry-exit-log', entryExitLogRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/salary', salaryRouter);
app.use('/api/staff', staffRouter);
app.use('/api/logs', logsRouter);

// Global Error Handler
app.use(errorHandler);

export default app;
