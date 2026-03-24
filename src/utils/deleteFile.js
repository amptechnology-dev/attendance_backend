import fs from 'fs';
import logger from '../config/logger.js';

export default function deleteFile(filePath) {
  fs.unlink(filePath, (err) => {
    if (err) {
      logger.error(err.message);
      return;
    }
    logger.info(`File deleted successfully: ${filePath}`);
  });
}
