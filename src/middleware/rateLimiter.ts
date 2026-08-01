import rateLimit from 'express-rate-limit';

export const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: {
    success: false,
    error: 'Too many requests',
    message: 'Too many requests from this IP, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Disable all validation warnings
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: {
    success: false,
    error: 'Too many authentication attempts',
    message: 'Too many login attempts, please try again after 15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Every chat turn is a paid Gemini call, and a grounded one ships the whole
 * transcript as input — so this needs a tighter bound than the general limiter.
 *
 * Keyed on the session user rather than IP: chat requires auth, and IP keying
 * would make everyone behind one office NAT share a single budget.
 */
export const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  keyGenerator: (req) => String(req.session?.userId ?? req.ip),
  message: {
    success: false,
    error: 'Chat limit exceeded',
    message: 'You have sent too many questions. Please wait a few minutes and try again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 uploads per hour
  message: {
    success: false,
    error: 'Upload limit exceeded',
    message: 'Too many uploads, please try again after 1 hour',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export default generalLimiter;
