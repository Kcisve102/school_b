import express from 'express';
import session from 'express-session';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';

import { sessionConfig } from './config/session';
import { testConnection } from './config/database';
import { VideoModel } from './models/Video';
import { errorHandler } from './middleware/errorHandler';
import { generalLimiter } from './middleware/rateLimiter';
import logger from './utils/logger';

import authRoutes from './routes/auth.routes';
import videoRoutes from './routes/video.routes';
import adminRoutes from './routes/admin.routes';
import aiRoutes from './routes/ai.routes';
import historyRoutes from './routes/history.routes';
import profileRoutes from './routes/profile.routes';
import freelancerRoutes from './routes/freelancer.routes';
import { FreelancerController } from './controllers/freelancer.controller';

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

// Trust exactly the reverse proxy hop(s) in front of this app (Caddy = 1).
// `true` would trust ANY proxy, letting a client spoof X-Forwarded-For and
// bypass every IP-based rate limit. Override with TRUST_PROXY_HOPS if the
// deployment adds another hop (e.g. a CDN in front of Caddy).
app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS || '1'));

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
app.use('/api/profile', profileRoutes);
app.use('/api/freelancer', freelancerRoutes);

// Freelancer.com's registered redirect URI is https://www.knowverd.com/auth,
// so the OAuth callback is mounted at the bare path, outside /api.
app.get('/auth', FreelancerController.callback);

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

    // Any video left mid-processing by a previous shutdown can never resume,
    // so mark it failed rather than leaving it stuck on 'processing'.
    try {
      const reconciled = await VideoModel.failStaleProcessing();
      if (reconciled > 0) {
        logger.warn(
          `Reconciled ${reconciled} video(s) left in 'processing' by a previous shutdown — marked failed`
        );
      }
    } catch (reconcileError) {
      logger.error('Failed to reconcile stale processing videos:', reconcileError);
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
