import { ValidationError } from 'yup';
import { ApiError } from '../utils/responseHandler.js';

const validateBody = (schema, stripUnknown = false) => {
  return async (req, res, next) => {
    try {
      // Validate the request body against the provided schema
      await schema.validate(req.body, { abortEarly: false, stripUnknown });

      // If validation passes, move to the next middleware
      next();
    } catch (err) {
      // If validation fails, return a structured error response
      if (err instanceof ValidationError) {
        const errors = err.inner.map((e) => ({
          field: e.path,
          message: e.message,
        }));
        return new ApiError(400, 'Validation Failed!', errors).send(res);
      }

      // Handle unexpected errors
      next(err);
    }
  };
};

export default validateBody;
