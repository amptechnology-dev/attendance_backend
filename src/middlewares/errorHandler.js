import { ApiError } from '../utils/responseHandler.js';
import logger from '../config/logger.js';

const errorHandler = (err, req, res, next) => {
  if (err instanceof ApiError) {
    return err.send(res); // Handle ApiError
  }

  // For all other errors, send a generic internal server error
  logger.error({
    message: err.message,
    statusCode: err.statusCode,
    stack: err.stack,
    errors: err.errors,
    route: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  const unknownError = new ApiError(
    500,
    'Internal Server Error',
    err.message,
    err.stack
  );
  return unknownError.send(res);
};

export default errorHandler;
