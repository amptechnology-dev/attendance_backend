import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// Define log levels and colors
const logLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
  },
};

// Apply color scheme to console logs (useful in development)
winston.addColors(logLevels.colors);

// Configure daily log rotation for file-based logs
const dailyRotateTransport = new DailyRotateFile({
  filename: 'logs/app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m', // Rotate log file after 20MB
  maxFiles: '10d', // Keep logs for 10 days
  level: 'info', // Log level threshold for file logs
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
});

// Initialize the logger with console and file transports
const logger = winston.createLogger({
  levels: logLevels.levels,
  transports: [
    // Console transport for real-time feedback in development
    new winston.transports.Console({
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    // Daily rotate file transport for persistent logging
    dailyRotateTransport,
  ],
});

export default logger;
