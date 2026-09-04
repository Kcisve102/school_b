import crypto from 'crypto';
import logger from '../utils/logger';

/**
 * Freelancer.com OAuth2 (authorization code) + minimal API client.
 *
 * Learners create their own Freelancer.com account in their own browser and
 * then authorise Knowverd. We never create accounts on their behalf: an account
 * must belong to the real person to pass verification and receive payouts.
 */

const AUTH_URL =
  process.env.FLN_AUTH_URL || 'https://accounts.freelancer.com/oauth/authorise';
const TOKEN_URL =
  process.env.FLN_TOKEN_URL || 'https://accounts.freelancer.com/oauth/token';
const API_BASE = process.env.FLN_API_BASE || 'https://www.freelancer.com';

// Freelancer.com authenticates API calls with this custom header, NOT
// "Authorization: Bearer" (verified against the official SDK).
const AUTH_HEADER = 'Freelancer-OAuth-V1';

export interface FreelancerTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export class FreelancerOAuthService {
  static isConfigured(): boolean {
    return Boolean(process.env.FLN_CLIENT_ID && process.env.FLN_CLIENT_SECRET);
  }

  static generateState(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  static buildAuthorizeUrl(state: string): string {
    const url = new URL(AUTH_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', process.env.FLN_CLIENT_ID || '');
    url.searchParams.set('redirect_uri', process.env.FLN_REDIRECT_URI || '');
    url.searchParams.set('scope', process.env.FLN_SCOPES || 'basic');
    url.searchParams.set('state', state);

    // Force the account picker instead of silently reusing whatever
    // freelancer.com session the browser already has. Without this, a learner
    // signing in with a second account is handed the token for the first one.
    url.searchParams.set('prompt', 'select_account consent');

    const advanced = process.env.FLN_ADVANCED_SCOPES;
    if (advanced) url.searchParams.set('advanced_scopes', advanced);

    return url.toString();
  }

  static async exchangeCode(code: string): Promise<FreelancerTokens> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.FLN_CLIENT_ID || '',
        client_secret: process.env.FLN_CLIENT_SECRET || '',
        redirect_uri: process.env.FLN_REDIRECT_URI || '',
      }),
    });

    const text = await res.text();
    let tokens: FreelancerTokens;
    try {
      tokens = JSON.parse(text);
    } catch {
      // Never log the body verbatim — it may carry a token on success paths.
      logger.error('Freelancer token endpoint returned non-JSON', { status: res.status });
      throw new Error('Freelancer.com returned an unexpected response');
    }

    if (!res.ok || !tokens.access_token) {
      logger.error('Freelancer token exchange failed', { status: res.status });
      throw new Error('Could not complete Freelancer.com authorisation');
    }

    return tokens;
  }

  static async refresh(refreshToken: string): Promise<FreelancerTokens> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.FLN_CLIENT_ID || '',
        client_secret: process.env.FLN_CLIENT_SECRET || '',
      }),
    });

    const tokens = (await res.json()) as FreelancerTokens;
    if (!res.ok || !tokens.access_token) {
      throw new Error('Could not refresh Freelancer.com authorisation');
    }
    return tokens;
  }

  /**
   * Unauthenticated GET. Project browsing does not require a token, which is
   * deliberate here: a learner can read jobs in their own language before they
   * have a Freelancer.com account at all. Connecting is only needed to act.
   */
  static async publicGet<T = unknown>(
    path: string,
    query: Record<string, string | number | boolean | string[]> = {}
  ): Promise<T> {
    const url = new URL(path, API_BASE);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
      else url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Knowverd', Accept: 'application/json' },
    });

    if (!res.ok) {
      logger.warn('Freelancer public API call failed', { path, status: res.status });
      throw new Error(`Freelancer.com API error (${res.status})`);
    }

    return (await res.json()) as T;
  }

  /** Authenticated GET against the Freelancer.com REST API. */
  static async apiGet<T = unknown>(
    accessToken: string,
    path: string,
    query: Record<string, string | number | boolean | string[]> = {}
  ): Promise<T> {
    const url = new URL(path, API_BASE);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
      else url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      headers: {
        [AUTH_HEADER]: accessToken,
        'User-Agent': 'Knowverd',
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      logger.warn('Freelancer API call failed', { path, status: res.status });
      throw new Error(`Freelancer.com API error (${res.status})`);
    }

    return (await res.json()) as T;
  }

  /** The authenticated learner's own Freelancer.com identity. */
  static async fetchSelf(accessToken: string) {
    const data = await this.apiGet<{ result?: { id?: number; username?: string } }>(
      accessToken,
      '/api/users/0.1/self'
    );
    return { id: data.result?.id ?? null, username: data.result?.username ?? null };
  }

  /**
   * Active projects matching a learner's generated job keywords. Search terms
   * come from the Gemini job service, which keeps them in English on purpose.
   */
  static async searchProjects(accessToken: string, query: string, limit = 10) {
    return this.apiGet(accessToken, '/api/projects/0.1/projects/active', {
      query,
      limit,
      job_details: true,
      full_description: true,
    });
  }

  /** A single project, with skills and the full description, for the detail page. */
  static async fetchProject(projectId: number) {
    const data = await this.publicGet<{ result?: Record<string, unknown> }>(
      `/api/projects/0.1/projects/${projectId}/`,
      { job_details: true, full_description: true, attachment_details: true }
    );
    return data.result ?? null;
  }

  /**
   * The client who posted a project. The project endpoints leave employer
   * fields null, so reputation has to be fetched separately — it is worth the
   * extra call: it is how a learner spots a client worth working for.
   */
  static async fetchEmployer(userId: number) {
    const data = await this.publicGet<{ result?: Record<string, unknown> }>(
      `/api/users/0.1/users/${userId}/`,
      { employer_reputation: true, country_details: true, status: true }
    );
    return data.result ?? null;
  }

  /** Project search that works before the learner has connected an account. */
  static async searchProjectsPublic(query: string, limit = 10) {
    return this.publicGet('/api/projects/0.1/projects/active', {
      query,
      limit,
      job_details: true,
      full_description: true,
    });
  }

  /**
   * Freelancer's skill taxonomy, cached in memory.
   *
   * The list is ~3,500 entries and effectively static, so it is fetched once
   * per process rather than on every recommendation.
   */
  private static skillIdCache: Map<string, { id: number; name: string }> | null = null;

  static async skillNameToId(): Promise<Map<string, { id: number; name: string }>> {
    if (this.skillIdCache) return this.skillIdCache;

    const data = await this.publicGet<{ result?: Array<{ id: number; name: string }> }>(
      '/api/projects/0.1/jobs/'
    );
    const map = new Map<string, { id: number; name: string }>();
    for (const job of data.result ?? []) {
      // Keyed lower-case for matching, but the taxonomy's own casing is kept
      // for display — it writes "AI Animation", not "Ai Animation".
      if (job?.name && job?.id) map.set(job.name.toLowerCase(), { id: job.id, name: job.name });
    }
    this.skillIdCache = map;
    return map;
  }

  /**
   * Resolve free-text skills from the generated profile onto Freelancer's
   * fixed taxonomy.
   *
   * Exact match first, then a contains match, because Gemini writes "Video
   * Editing" where the taxonomy has "Video Editing" but also writes
   * "AI Animation" where only "Animation" exists.
   */
  static async resolveSkillIds(
    skills: string[],
    max = 6
  ): Promise<Array<{ id: number; name: string }>> {
    const map = await this.skillNameToId();
    const ids: Array<{ id: number; name: string }> = [];

    for (const raw of skills) {
      const skill = raw.trim().toLowerCase();
      if (!skill) continue;

      let hit = map.get(skill);
      if (!hit) {
        for (const [name, candidate] of map) {
          if (skill.includes(name) || name.includes(skill)) {
            hit = candidate;
            break;
          }
        }
      }
      if (hit && !ids.some((e) => e.id === hit!.id)) ids.push(hit);
      if (ids.length >= max) break;
    }

    return ids;
  }

  /**
   * Jobs matching a learner's skills.
   *
   * Filtered by skill id, not by free-text query: a text search for
   * "Video Editing" returns finance and automation work, because the query
   * matches anywhere in the description. Filtering on the taxonomy returns
   * jobs actually tagged with the skill.
   */
  static async recommendedProjects(skills: string[], limit = 12) {
    const matched = await this.resolveSkillIds(skills);
    if (matched.length === 0) return { projects: [], matchedSkills: [] as string[] };

    const data = await this.publicGet<{ result?: { projects?: unknown[] } }>(
      '/api/projects/0.1/projects/active',
      {
        'jobs[]': matched.map((m) => String(m.id)),
        limit,
        job_details: true,
        full_description: true,
      }
    );

    return {
      projects: data.result?.projects ?? [],
      matchedSkills: matched.map((m) => m.name),
    };
  }
}

export default FreelancerOAuthService;
