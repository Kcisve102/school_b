import { Request, Response } from 'express';
import { ApiResponse } from '../types';
import FreelancerOAuthService from '../services/freelancer-oauth.service';
import FreelancerConnection from '../models/FreelancerConnection';
import CareerProfileModel from '../models/CareerProfile';
import logger from '../utils/logger';

const CLIENT_URL = process.env.CLIENT_URL || 'https://www.knowverd.com';

/** Sends the learner back to the SPA with a result flag rather than raw JSON. */
const backToApp = (res: Response, params: Record<string, string>) => {
  const url = new URL('/profile', CLIENT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return res.redirect(url.toString());
};

export class FreelancerController {
  /** Whether this learner has connected their Freelancer.com account. */
  static async getStatus(req: Request, res: Response<ApiResponse>) {
    try {
      const status = await FreelancerConnection.getPublic(req.session.userId!);
      return res.json({ success: true, data: status });
    } catch (error) {
      logger.error('Failed to read Freelancer connection status', { error });
      return res
        .status(500)
        .json({ success: false, error: 'Could not read connection status' });
    }
  }

  /**
   * Step 1 — redirect the learner to Freelancer.com's consent screen.
   *
   * The learner must already have their own Freelancer.com account; the SPA
   * walks them through creating one first. We never create accounts for them.
   */
  static async startAuth(req: Request, res: Response<ApiResponse>) {
    if (!FreelancerOAuthService.isConfigured()) {
      return res
        .status(503)
        .json({ success: false, error: 'Freelancer.com integration is not configured' });
    }

    const state = FreelancerOAuthService.generateState();
    req.session.flnOAuthState = state;

    // Persist the session before redirecting, or the state is lost on return.
    req.session.save((err) => {
      if (err) {
        logger.error('Could not persist OAuth state', { error: err });
        return res
          .status(500)
          .json({ success: false, error: 'Could not start authorisation' });
      }
      return res.redirect(FreelancerOAuthService.buildAuthorizeUrl(state));
    });
  }

  /**
   * Step 2 — Freelancer.com redirects here with ?code=...
   * This is the registered redirect URI (https://www.knowverd.com/auth).
   */
  static async callback(req: Request, res: Response) {
    const { code, state, error } = req.query as Record<string, string | undefined>;

    if (error) return backToApp(res, { freelancer: 'error', reason: error });
    if (!code) return backToApp(res, { freelancer: 'error', reason: 'no_code' });

    const expected = req.session.flnOAuthState;
    delete req.session.flnOAuthState;
    if (!state || !expected || state !== expected) {
      logger.warn('Freelancer OAuth state mismatch', { userId: req.session.userId });
      return backToApp(res, { freelancer: 'error', reason: 'invalid_state' });
    }

    const userId = req.session.userId;
    if (!userId) return backToApp(res, { freelancer: 'error', reason: 'not_logged_in' });

    try {
      const tokens = await FreelancerOAuthService.exchangeCode(code);

      // Resolve the learner's Freelancer identity for display; a failure here
      // must not lose the connection we just established.
      let identity: { id: number | null; username: string | null } = {
        id: null,
        username: null,
      };
      try {
        identity = await FreelancerOAuthService.fetchSelf(tokens.access_token);
      } catch (err) {
        logger.warn('Connected but could not read Freelancer profile', { userId });
      }

      await FreelancerConnection.save({
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        scope: tokens.scope ?? null,
        expiresInSeconds: tokens.expires_in ?? null,
        freelancerUserId: identity.id,
        freelancerUsername: identity.username,
      });

      logger.info('Freelancer account connected', { userId });
      return backToApp(res, { freelancer: 'connected' });
    } catch (err) {
      logger.error('Freelancer OAuth callback failed', { userId, error: err });
      return backToApp(res, { freelancer: 'error', reason: 'exchange_failed' });
    }
  }

  /** Removes the connection and returns the slot against the app's user limit. */
  static async disconnect(req: Request, res: Response<ApiResponse>) {
    try {
      await FreelancerConnection.disconnect(req.session.userId!);
      return res.json({ success: true, message: 'Freelancer.com account disconnected' });
    } catch (error) {
      logger.error('Failed to disconnect Freelancer account', { error });
      return res.status(500).json({ success: false, error: 'Could not disconnect' });
    }
  }

  /**
   * Projects matching a query, for the learner's connected account.
   * Keywords come from the Gemini job service.
   */
  static async searchProjects(req: Request, res: Response<ApiResponse>) {
    try {
      const token = await FreelancerConnection.getAccessToken(req.session.userId!);
      if (!token) {
        return res
          .status(409)
          .json({ success: false, error: 'Freelancer.com account is not connected' });
      }

      const query = String(req.query.q || '').trim();
      if (!query) {
        return res.status(400).json({ success: false, error: 'A search query is required' });
      }

      const limit = Math.min(Number(req.query.limit) || 10, 50);
      const data = await FreelancerOAuthService.searchProjects(token, query, limit);
      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Freelancer project search failed', { error });
      return res.status(502).json({ success: false, error: 'Could not search projects' });
    }
  }

  /**
   * One project, in full, for the in-app detail page.
   *
   * Public on purpose: browsing jobs needs no Freelancer.com account, so a
   * learner can read listings in their own language before deciding to sign up.
   * The employer is a second call — the project payload leaves those fields
   * null — and is best-effort, since a missing profile must not hide the job.
   */
  static async getProject(req: Request, res: Response<ApiResponse>) {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid project id' });
    }

    try {
      const project = await FreelancerOAuthService.fetchProject(projectId);
      if (!project) {
        return res.status(404).json({ success: false, error: 'Project not found' });
      }

      const ownerId = Number((project as { owner_id?: number }).owner_id);
      let employer: Record<string, unknown> | null = null;
      if (Number.isInteger(ownerId) && ownerId > 0) {
        try {
          employer = await FreelancerOAuthService.fetchEmployer(ownerId);
        } catch {
          logger.warn('Could not load employer profile', { projectId, ownerId });
        }
      }

      return res.json({ success: true, data: { project, employer } });
    } catch (error) {
      logger.error('Freelancer project detail failed', { projectId, error });
      return res.status(502).json({ success: false, error: 'Could not load this job' });
    }
  }

  /** Project search for learners who have not connected an account yet. */
  static async searchProjectsPublic(req: Request, res: Response<ApiResponse>) {
    const query = String(req.query.q || '').trim();
    if (!query) {
      return res.status(400).json({ success: false, error: 'A search query is required' });
    }

    try {
      const limit = Math.min(Number(req.query.limit) || 10, 50);
      const data = await FreelancerOAuthService.searchProjectsPublic(query, limit);
      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Freelancer public project search failed', { error });
      return res.status(502).json({ success: false, error: 'Could not search projects' });
    }
  }

  /**
   * Real jobs matching the learner's own generated skills.
   *
   * Replaces the invented job cards that linked out to an Indeed keyword
   * search: those described roles that might exist, these are live postings
   * with a budget and a client. Needs a Knowverd login to know whose profile
   * to read, but no Freelancer.com account.
   *
   * `skills` may also be passed explicitly, which is how the quiz result page
   * asks for jobs matching one attempt rather than the whole profile.
   */
  static async getRecommended(req: Request, res: Response<ApiResponse>) {
    try {
      const explicit = String(req.query.skills || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      let skills = explicit;
      if (skills.length === 0) {
        const profile = await CareerProfileModel.findByUserId(req.session.userId!);
        skills = Array.isArray(profile?.skills) ? profile!.skills : [];
      }

      if (skills.length === 0) {
        return res.json({ success: true, data: { projects: [], matchedSkills: [] } });
      }

      const limit = Math.min(Number(req.query.limit) || 12, 50);
      const data = await FreelancerOAuthService.recommendedProjects(skills, limit);
      return res.json({ success: true, data });
    } catch (error) {
      logger.error('Freelancer recommendations failed', { error });
      return res.status(502).json({ success: false, error: 'Could not load matching jobs' });
    }
  }
}

export default FreelancerController;
