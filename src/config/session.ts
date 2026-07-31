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

const DEV_FALLBACK_SECRET = 'your-secret-key-change-in-production';

/**
 * A publicly-known signing secret lets anyone forge a session cookie, so in
 * production a missing SESSION_SECRET is a boot failure rather than a silent
 * fallback. Development keeps the fallback with a loud warning.
 */
function resolveSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret === DEV_FALLBACK_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SECRET must be set to a unique value in production. ' +
          'Refusing to start with a default or missing session secret.'
      );
    }
    console.warn(
      '⚠️  SESSION_SECRET is unset — using an insecure development fallback. ' +
        'This will refuse to boot in production.'
    );
    return DEV_FALLBACK_SECRET;
  }

  return secret;
}

export const sessionConfig: session.SessionOptions = {
  secret: resolveSessionSecret(),
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
