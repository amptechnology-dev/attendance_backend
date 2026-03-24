import app from './app.js';
import connectDB from './config/db.js';
import logger from './config/logger.js';

const startServer = async () => {
  try {
    await connectDB();
    const port = process.env.PORT || 3001;
    app.listen(port, () => {
      logger.info(
        `Server is running. \n Port: ${port}\n Mode: ${process.env.NODE_ENV}`
      );
    });
  } catch (error) {
    logger.error('Error starting the server:', error);
    process.exit(1);
  }
};

startServer();
