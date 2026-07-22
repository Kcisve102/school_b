import express from 'express';
import session from 'express-session';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';

import { sessionConfig } from './config/session';
import { testConnection } from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { generalLimiter } from './middleware/rateLimiter';
import logger from './utils/logger';

import authRoutes from './routes/auth.routes';
import videoRoutes from './routes/video.routes';
import adminRoutes from './routes/admin.routes';
import aiRoutes from './routes/ai.routes';
import historyRoutes from './routes/history.routes';

dotenv.config();

const app = express();
const httpServer = createServer(app);

const allowedOrigins = [
  "http://localhost:5173",           // Local development
  "https://knowverd.com",            // Production
  "https://www.knowverd.com",        // Production with www
];

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || allowedOrigins,
    credentials: true,
  },
});

app.set('io', io);

const PORT = process.env.PORT || 5000;

// Enable trust proxy for apps behind reverse proxies (nginx, etc.)
app.set('trust proxy', true);

app.use(helmet());

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session(sessionConfig));

app.use(generalLimiter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/history', historyRoutes);

app.use(errorHandler);

io.on('connection', (socket) => {
  logger.info(`WebSocket client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    logger.info(`WebSocket client disconnected: ${socket.id}`);
  });
});

const startServer = async () => {
  try {
    const dbConnected = await testConnection();

    if (!dbConnected) {
      logger.error('Failed to connect to database. Exiting...');
      process.exit(1);
    }

    httpServer.listen(PORT, () => {
      logger.info(`
🚀 Server started successfully!
📡 Server running on port ${PORT}
🔗 API: http://localhost:${PORT}/api
🌐 Health check: http://localhost:${PORT}/health
📊 Environment: ${process.env.NODE_ENV || 'development'}
      `);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
