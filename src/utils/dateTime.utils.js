import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { startOfMonth, endOfMonth, getMonth, getYear } from 'date-fns';

const timeZone = 'Asia/Kolkata';
/**
 * Get the start and end of the local month as formatted date strings (YYYY-MM-DD) from UTC Date-time.
 *  @param {Date} [utcDate=new Date()] - Optional UTC Date-time. Defaults to current UTC time.
 * @returns {{ startDate: string, endDate: string }} - Formatted local dates
 */
export function getLocalMonthBoundariesFormatted(utcDate = new Date()) {
  const localDate = toZonedTime(utcDate, timeZone);

  const startOfMonth = new Date(localDate.getFullYear(), localDate.getMonth(), 1);
  const endOfMonth = new Date(localDate.getFullYear(), localDate.getMonth() + 1, 0);

  const startDate = formatInTimeZone(startOfMonth, timeZone, 'yyyy-MM-dd');
  const endDate = formatInTimeZone(endOfMonth, timeZone, 'yyyy-MM-dd');

  return { startDate, endDate };
}
/**
 * Get the start and end date of a month in 'yyyy-MM-dd' format
 * @param {number} year - Full year (e.g., 2024)
 * @param {number} month - Month number (1-12)
 * @returns {{ startDate: string, endDate: string }}
 */
export function getMonthBoundariesFormatted(month, year) {
  if (month < 1 || month > 12) throw new Error('Invalid month number. Must be between 1 and 12.');
  // JS months are zero-based: January = 0
  const baseDate = new Date(year, month - 1, 1);
  const startDate = formatInTimeZone(startOfMonth(baseDate), timeZone, 'yyyy-MM-dd');
  const endDate = formatInTimeZone(endOfMonth(baseDate), timeZone, 'yyyy-MM-dd');
  return { startDate, endDate };
}
/**
 * Get the current date in set time zone.
 * @returns {string} - Current date in 'yyyy-MM-dd' format
 */
export function getCurrentDate() {
  const now = new Date();
  return formatInTimeZone(now, timeZone, 'yyyy-MM-dd');
}

export function getServerTime() {
  const now = new Date();
  return toZonedTime(now, timeZone);
}
export function getLocalTimeFormatted(utcDate = new Date()) {
  return formatInTimeZone(utcDate, timeZone, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Get the current financial year with timezone consideration
 * @param {Date} [utcDate=new Date()] - UTC Date, defaults to now
 * @returns {{ financialYear: string, startDate: Date, endDate: Date }}
 */
export function getCurrentFinancialYear(utcDate = new Date()) {
  const localDate = toZonedTime(utcDate, timeZone);
  const month = getMonth(localDate);
  const year = getYear(localDate);

  let startYear, endYear;

  if (month >= 3) {
    // April or later
    startYear = year;
    endYear = year + 1;
  } else {
    // Before April
    startYear = year - 1;
    endYear = year;
  }
  // Create start and end dates directly in the timezone
  const startDate = toZonedTime(new Date(`${startYear}-04-01T00:00:00Z`), timeZone);
  const endDate = toZonedTime(new Date(`${endYear}-03-31T23:59:59Z`), timeZone);

  return {
    financialYear: `${startYear}-${endYear}`,
    startDate,
    endDate,
  };
}
