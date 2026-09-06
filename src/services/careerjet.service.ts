import logger from '../utils/logger';

/**
 * Careerjet v4 job search.
 *
 * Careerjet aggregates ~90 country job sites, which is why it is here rather
 * than a single-country board: a learner searching in Chinese or from outside
 * the US/UK gets results at all. There is no per-learner account — one
 * publisher key serves every search — so this needs no OAuth and no connection
 * gate, and it works before a learner has signed up anywhere.
 *
 * Read-only. Nothing from Careerjet is written to MySQL: the `url` on each job
 * is a tracked `jobviewtrack.com` redirect that Careerjet expects to be clicked
 * fresh, and storing listings would serve learners stale or filled jobs.
 */

const API_BASE = process.env.CAREERJET_API_BASE || 'https://search.api.careerjet.net/v4';

const DEFAULT_LOCALE = process.env.CAREERJET_LOCALE || 'en_US';
const DEFAULT_LIMIT = 6;

/**
 * Careerjet requires the end user's IP and user agent on every call — it is an
 * affiliate network and attributes clicks to the learner's session, so these
 * are not optional and a missing one returns HTTP 403. When Express cannot
 * determine a real client IP (server-side calls, local dev) we still must send
 * something syntactically valid.
 */
const FALLBACK_UA = 'Mozilla/5.0 (compatible; Knowverd/1.0)';

/**
 * Careerjet validates `user_ip` against more than syntax: public resolvers and
 * datacenter ranges are refused with "Invalid user_ip" (8.8.8.8 and 1.1.1.1
 * both are), while omitting it fails with "Missing param user_ip". The only
 * value that reliably passes is a genuine end-user address.
 *
 * In production `req.ip` is the learner's own address and this is never
 * needed. It exists for local development, where `req.ip` is ::1: this server's
 * own public address is discovered once and reused, so searches work in dev
 * without inventing an address Careerjet will reject.
 */
let cachedEgressIp: string | null = null;
let egressLookup: Promise<string | null> | null = null;

async function resolveEgressIp(): Promise<string | null> {
  if (cachedEgressIp) return cachedEgressIp;

  // One lookup per process, shared by concurrent callers.
  if (!egressLookup) {
    egressLookup = (async () => {
      try {
        const res = await fetch('https://api.ipify.org', {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const ip = (await res.text()).trim();
        cachedEgressIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
        return cachedEgressIp;
      } catch {
        logger.warn('Could not determine egress IP for Careerjet');
        return null;
      } finally {
        egressLookup = null;
      }
    })();
  }

  return egressLookup;
}

/**
 * Careerjet requires a Referer on every call ("Undeclared referrer") — it
 * identifies the publisher site the search is made from. Undocumented in the
 * v4 parameter list but enforced.
 */
const REFERER = process.env.CAREERJET_REFERER || 'https://www.knowverd.com';

export interface CareerjetJob {
  title: string;
  company: string | null;
  locations: string | null;
  description: string | null;
  /** Tracked outbound redirect. Always link to this, never rewrite it. */
  url: string;
  postedAt: number | null;
  salary: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  /** Y yearly · M monthly · W weekly · D daily · H hourly. */
  salaryPeriod: 'Y' | 'M' | 'W' | 'D' | 'H' | null;
}

export interface CareerjetSearchResult {
  jobs: CareerjetJob[];
  count: number;
  /** Set when Careerjet could not resolve `location` and searched nothing. */
  locationSuggestions?: string[];
}

interface RawCareerjetJob {
  title?: string;
  company?: string;
  locations?: string;
  description?: string;
  url?: string;
  date?: string;
  salary?: string;
  salary_min?: number | string;
  salary_max?: number | string;
  salary_currency_code?: string;
  salary_type?: string;
}

interface RawCareerjetResponse {
  type?: 'JOBS' | 'LOCATIONS' | 'ERROR';
  hits?: number;
  jobs?: RawCareerjetJob[];
  locations?: string[];
  error?: string;
}

export interface CareerjetSearchOptions {
  location?: string;
  locale?: string;
  limit?: number;
  page?: number;
  /** p permanent · c contract · t temporary · i internship · v volunteering. */
  contractType?: string;
  /** f full-time · p part-time. */
  workHours?: string;
  sort?: 'relevance' | 'date' | 'salary';
  userIp?: string;
  userAgent?: string;
}

const SALARY_PERIODS = ['Y', 'M', 'W', 'D', 'H'] as const;

export class CareerjetService {
  static isConfigured(): boolean {
    return Boolean(process.env.CAREERJET_API_KEY);
  }

  static async searchJobs(
    keywords: string,
    opts: CareerjetSearchOptions = {}
  ): Promise<CareerjetSearchResult> {
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 100);

    const userIp = opts.userIp || (await resolveEgressIp());

    const data = await this.get<RawCareerjetResponse>('/query', {
      keywords,
      locale_code: opts.locale || DEFAULT_LOCALE,
      location: opts.location,
      contract_type: opts.contractType,
      work_hours: opts.workHours,
      sort: opts.sort,
      page_size: limit,
      page: Math.min(Math.max(opts.page ?? 1, 1), 10),
      user_ip: userIp || undefined,
      user_agent: opts.userAgent || FALLBACK_UA,
    });

    // An ambiguous or unknown location is answered with candidate places
    // instead of jobs. That is a 200, not an error, so it must be handled
    // here or it silently reads as "no jobs found".
    if (data.type === 'LOCATIONS') {
      return { jobs: [], count: 0, locationSuggestions: data.locations ?? [] };
    }

    // Careerjet ignores page_size and always returns 20 (verified against the
    // live API at 3 and 6), so the caller's limit is applied here. It is still
    // sent, in case they honour it later.
    return {
      jobs: (data.jobs ?? [])
        .map(mapJob)
        .filter((job): job is CareerjetJob => job !== null)
        .slice(0, limit),
      count: data.hits ?? 0,
    };
  }

  private static async get<T>(
    path: string,
    query: Record<string, string | number | undefined>
  ): Promise<T> {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }

    // Basic auth: the API key is the username and the password is empty.
    // The trailing colon is required — without it Careerjet rejects the key.
    const credentials = Buffer.from(`${process.env.CAREERJET_API_KEY}:`).toString('base64');

    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${credentials}`,
        Referer: REFERER,
        'User-Agent': 'Knowverd',
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      // Log the path and status only. The URL carries no key (it is in the
      // header) but the body may echo request detail, so it is never logged.
      logger.warn('Careerjet API call failed', { path, status: res.status });
      throw new Error(`Careerjet API error (${res.status})`);
    }

    return (await res.json()) as T;
  }
}

/** Careerjet sends salary bounds as strings in some locales. */
function toNumber(value: number | string | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A job with no URL cannot be applied to and is dropped: the outbound link is
 * the entire point of the handoff, and a card that goes nowhere wastes a tap
 * on a slow connection.
 */
function mapJob(raw: RawCareerjetJob): CareerjetJob | null {
  if (!raw.url || !raw.title) return null;

  const parsedDate = raw.date ? Date.parse(raw.date) : NaN;
  const period = raw.salary_type?.toUpperCase();

  return {
    title: raw.title,
    company: raw.company || null,
    locations: raw.locations || null,
    description: raw.description || null,
    url: raw.url,
    postedAt: Number.isNaN(parsedDate) ? null : parsedDate,
    salary: raw.salary || null,
    salaryMin: toNumber(raw.salary_min),
    salaryMax: toNumber(raw.salary_max),
    salaryCurrency: raw.salary_currency_code || null,
    salaryPeriod: SALARY_PERIODS.includes(period as never)
      ? (period as CareerjetJob['salaryPeriod'])
      : null,
  };
}

export default CareerjetService;
