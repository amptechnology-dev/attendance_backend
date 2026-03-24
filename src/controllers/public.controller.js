import { ApiResponse } from '../utils/responseHandler.js';
import expressAsyncHandler from 'express-async-handler';

export const index = expressAsyncHandler(async (req, res) => {
  const data = 'Hello World';
  new ApiResponse(200, data, 'Success').send(res);
});
