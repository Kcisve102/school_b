import session from 'express-session';
import MySQLStore from 'express-mysql-session';
import { dbConfig } from './database';

const MySQLStoreSession = MySQLStore(session);

const sessionStore = new MySQLStoreSession({
  ...dbConfig,
  clearExpired: true,
  checkExpirationInterval: 900000, // 15 minutes
  expiration: 86400000, // 24 hours
  createDatabaseTable: true,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
});

export const sessionConfig: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  name: process.env.SESSION_NAME || 'video_platform_session',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000'), // 24 hours
    sameSite: 'lax'
  }
};

export default sessionConfig;
