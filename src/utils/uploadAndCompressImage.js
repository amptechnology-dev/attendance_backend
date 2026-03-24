import multer from 'multer';
import path from 'path';
import { ApiError } from './responseHandler.js';
import sharp from 'sharp';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
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

export const compressImage = async (buffer) => {
  // Convert to WebP with compression
  const compressedBuffer = await sharp(buffer)
    .resize({ width: 1000 }) // Resize for better compression
    .webp({ quality: 50 }) // Adjust quality for smaller size
    .toBuffer();

  return { buffer: compressedBuffer, mimetype: 'image/webp' };
};
