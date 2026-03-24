import { getLocalTimeFormatted } from '../utils/dateTime.utils.js';
import { LoginLog } from '../models/loginLog.model.js';

export async function logUserLogin({
  office,
  username,
  userId,
  ip,
  hostname,
  userAgent,
  requestUrl,
  status, // 'success' or 'fail'
  authType,
  role, // Include only for success
}) {
  // if (process.env.NODE_ENV === 'development') return;

  const logDetails = {
    office,
    username,
    userId,
    ip,
    hostname,
    userAgent,
    requestUrl,
    status,
    authType,
    localTime: getLocalTimeFormatted(),
  };

  if (status === 'success') logDetails.role = role;

  await LoginLog.create(logDetails);
}
