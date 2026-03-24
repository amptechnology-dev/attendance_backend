import expressAsyncHandler from 'express-async-handler';
import { ApiResponse, ApiError } from '../../utils/responseHandler.js';
import { Office } from '../../models/office.model.js';

export const me = expressAsyncHandler(async (req, res) => {
  const office = await Office.findOne({ _id: req.admin.office }).select('name');
  req.admin.office = office;
  const admin = req.admin;
  if (!admin) {
    throw new ApiError(404, 'Admin not found.');
  }
  return new ApiResponse(200, admin, 'Success').send(res);
});
