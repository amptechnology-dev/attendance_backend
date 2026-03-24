import { ApiError } from '../utils/responseHandler.js';

/**
 * Middleware to parse monthYearInput and attach the month and year to req.body
 * @param req.body.monthYearInput - YYYY-MM
 */
export const parseMonthInput = (req, res, next) => {
  const { monthYearInput } = req.body;

  if (monthYearInput && typeof monthYearInput === 'string' && monthYearInput.includes('-')) {
    const [yearStr, monthStr] = monthYearInput.split('-');

    const month = parseInt(monthStr, 10);
    const year = parseInt(yearStr, 10);

    if (!isNaN(month) && !isNaN(year)) {
      // Attach to req.body for controller use
      req.body.month = month;
      req.body.year = year;
    } else {
      throw new ApiError(400, 'Bad request', [
        { field: 'monthYearInput', message: 'Invalid monthYearInput. Please provide a valid YYYY-MM format.' },
      ]);
    }
  }

  next();
};
