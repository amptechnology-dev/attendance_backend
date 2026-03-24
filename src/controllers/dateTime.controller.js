import expressAsyncHandler from 'express-async-handler';
import { ApiResponse } from '../utils/responseHandler.js';
import { getServerTime as getServerTimeUtil, getCurrentFinancialYear } from '../utils/dateTime.utils.js';

export const getServerTime = expressAsyncHandler(async (req, res) => {
  const serverTime = getServerTimeUtil();
  const currentFinancialYear = getCurrentFinancialYear();
  return new ApiResponse(200, { serverTime, currentFinancialYear }, 'Server time fetched successfully.').send(res);
});
