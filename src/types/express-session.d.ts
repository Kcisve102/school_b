import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    email?: string;
    isAdmin?: boolean;
    /** CSRF state for an in-flight Freelancer.com OAuth authorisation. */
    flnOAuthState?: string;
  }
}
