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
export type HandoffPlatform =
  | 'indeed'
  | 'ziprecruiter'
  | 'glassdoor'
  | 'dice'
  /** Retained for handoffs recorded before these providers were removed:
   *  the rows are already in MySQL and must still validate. */
  | 'careerjet'
  | 'freelancer';

/**
 * Whitelist for `recordHandoff`. A client-supplied platform string is never
 * stored as-is — it is matched against this list or rejected.
 */
export const HANDOFF_PLATFORMS: readonly HandoffPlatform[] = [
  'indeed',
  'ziprecruiter',
  'glassdoor',
  'dice',
  // Kept so rows written before Careerjet and Freelancer.com were removed
  // still validate.
  'careerjet',
  'freelancer',
];

/**
 * The structured sections of a resume, all supplied by the learner.
 *
 * NOTHING here may be generated. The drafting prompt is forbidden from
 * inventing employers, dates and schools, so every value in these types comes
 * from something the learner typed about themselves; the AI's only role is to
 * split that text into fields and tidy the wording.
 *
 * Dates are free text, never DATE columns. A learner types "summer 2022" or
 * "2019-2021", and coercing that into a date throws away the truth to gain a
 * sortability nothing needs. Do not "fix" these into real dates.
 */
export interface ResumeExperience {
  role: string;
  employer: string;
  location: string | null;
  start: string;
  /** Null when the role is ongoing, or when the learner did not say. */
  end: string | null;
  current: boolean;
  /** Duties in the learner's own words, tidied. Never invented. */
  bullets: string[];
}

export interface ResumeEducation {
  credential: string;
  /** Null when the learner named a qualification but not where they earned it. */
  institution: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  detail: string | null;
}

export interface ResumeProject {
  name: string;
  detail: string | null;
  link: string | null;
}

export interface ResumeCertification {
  name: string;
  issuer: string | null;
  issued: string | null;
}

export interface ProfileLink {
  label: string;
  url: string;
}

/** Which resume section an intake question is collecting facts for. */
export type IntakeSection =
  | 'experience'
  | 'education'
  | 'projects'
  | 'certifications'
  | 'contact';

export const INTAKE_SECTIONS: readonly IntakeSection[] = [
  'experience',
  'education',
  'projects',
  'certifications',
  'contact',
];

/**
 * One question in the adaptive intake, written by Gemini for a specific target
 * role. English, like the resume itself — the surrounding UI stays localized.
 */
export interface IntakeQuestion {
  id: string;
  section: IntakeSection;
  prompt: string;
  helper: string;
  placeholder: string;
  /** A usable resume is still possible without this answer, so Skip is offered. */
  optional: boolean;
}

export interface IntakeAnswer {
  id: string;
  section: IntakeSection;
  prompt: string;
  answer: string;
}

/**
 * What the structuring call returns: a whole profile shape, so the review
 * screen can hand it to the existing save path unchanged. Not persisted here —
 * see the note on generateDraft in profile.controller.ts.
 */
export interface StructuredResumeDraft {
  experience: ResumeExperience[];
  education: ResumeEducation[];
  projects: ResumeProject[];
  certifications: ResumeCertification[];
  phone: string | null;
  city: string | null;
  links: ProfileLink[];
  headline: string;
  summary: string;
  skills: string[];
  job_titles: string[];
}
