import { Request, Response } from 'express';
import { ApiResponse } from '../types';
import CareerjetService from '../services/careerjet.service';
import logger from '../utils/logger';

/**
 * Careerjet rejects non-routable addresses outright ("Invalid user_ip"), and
 * in local development req.ip is ::1 or 127.0.0.1. Those are dropped here so
 * the service falls back to a valid address instead of failing the search.
 */
const isPublicIp = (ip?: string): boolean => {
  if (!ip) return false;

  // Express reports IPv4 clients as ::ffff:127.0.0.1 behind an IPv6 socket.
  const bare = ip.replace(/^::ffff:/, '');

  if (bare === '::1' || bare === '127.0.0.1') return false;
  if (/^10\./.test(bare)) return false;
  if (/^192\.168\./.test(bare)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(bare)) return false;

  return true;
};

export class CareerjetController {
  /**
   * Public job search. No Careerjet account exists for a learner to connect,
   * so there is nothing to gate on.
   */
  static async searchJobs(req: Request, res: Response<ApiResponse>) {
    if (!CareerjetService.isConfigured()) {
      return res
        .status(503)
        .json({ success: false, error: 'Job search is not configured' });
    }

    const keywords = String(req.query.q || '').trim();
    if (!keywords) {
      return res.status(400).json({ success: false, error: 'A search query is required' });
    }

    try {
      const data = await CareerjetService.searchJobs(keywords, {
        location: String(req.query.location || '').trim() || undefined,
        locale: String(req.query.locale || '').trim() || undefined,
        contractType: String(req.query.contractType || '').trim() || undefined,
        workHours: String(req.query.workHours || '').trim() || undefined,
        limit: Number(req.query.limit) || undefined,
        page: Number(req.query.page) || undefined,

        // Careerjet attributes every call to the end user, so the learner's own
        // IP and user agent are forwarded rather than the server's. `trust
        // proxy` is set in index.ts, so req.ip is the real client address.
        userIp: isPublicIp(req.ip) ? req.ip?.replace(/^::ffff:/, '') : undefined,
        userAgent: req.get('user-agent') || undefined,
      });

      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Careerjet job search failed', { error });
      return res.status(502).json({ success: false, error: 'Could not search jobs' });
    }
  }
}

export default CareerjetController;
