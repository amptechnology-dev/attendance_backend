import { LoginLog } from '../../models/loginLog.model.js';
import expressAsyncHandler from 'express-async-handler';
import { ApiResponse } from '../../utils/responseHandler.js';

export const getLoginLogs = expressAsyncHandler(async (req, res) => {
  const loginLogs = await LoginLog.find({ office: req.admin.office });
  return new ApiResponse(200, loginLogs, 'Login logs fetched successfully.').send(res);
});
