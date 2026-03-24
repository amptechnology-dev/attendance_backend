import multer from 'multer';
import path from 'path';
import { ApiError } from '../utils/responseHandler.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 300 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new ApiError(400, 'Only images are allowed (jpeg, jpg, png).'));
  },
});

export default upload;
