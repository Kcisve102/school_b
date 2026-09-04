/**
 * A career profile draft as Gemini returns it, before anything is persisted.
 *
 * Deliberately kept separate from the `CareerProfile` row type: a draft has no
 * id, no owner and no timestamps, and `generateDraft` hands one straight back to
 * the client without writing it. Only an explicit PUT turns a draft into a row.
 */
export interface CareerProfileDraft {
  headline: string;
  summary: string;
  skills: string[];
  job_titles: string[];
}

export interface GeminiCareerProfileResponse extends CareerProfileDraft {
  tokens_used: number;
}

/** The destinations a learner can hand their profile off to. */
export type HandoffPlatform = 'indeed' | 'ziprecruiter' | 'glassdoor' | 'dice';

/**
 * Whitelist for `recordHandoff`. A client-supplied platform string is never
 * stored as-is — it is matched against this list or rejected.
 */
export const HANDOFF_PLATFORMS: readonly HandoffPlatform[] = [
  'indeed',
  'ziprecruiter',
  'glassdoor',
  'dice',
];
