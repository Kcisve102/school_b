/// <reference path="../types/express-session.d.ts" />
import { Request, Response } from 'express';
import { ApiResponse, CareerProfile } from '../types';
import logger from '../utils/logger';
import { CareerProfileModel } from '../models/CareerProfile';
import { QuizAttemptModel } from '../models/QuizAttempt';
import { VideoModel } from '../models/Video';
import { SummaryModel } from '../models/Summary';
import { UserModel } from '../models/User';
import { GeminiCareerProfileService } from '../services/gemini-career-profile.service';
import { GeminiIntakeService, ProfileCoverage } from '../services/gemini-intake.service';
import {
  HANDOFF_PLATFORMS,
  HandoffPlatform,
  INTAKE_SECTIONS,
  IntakeAnswer,
  IntakeSection,
  ResumeCertification,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
} from '../types/profile.types';

/**
 * A career profile is only offered to learners who scored at least this much.
 *
 * This is the third and strictest of three coexisting thresholds, and they are
 * deliberately independent:
 *   - `passed >= 60`                 — whether the quiz itself was passed
 *   - `JOB_SUGGESTION_THRESHOLD = 0` — job title suggestions, shown to everyone
 *     (both in history.controller.ts)
 *   - `CAREER_PROFILE_THRESHOLD = 80` — here; publishing a skills profile under
 *     the learner's real name warrants a higher bar than browsing job ideas.
 *
 * The frontend duplicates this number to decide whether to show the CTA, but
 * that copy is only an affordance. THIS one is authoritative: the check in
 * `generateDraft` below is what actually prevents a sub-80% draft.
 */
const CAREER_PROFILE_THRESHOLD = 80;

const MAX_HEADLINE_LENGTH = 255;
const MAX_SUMMARY_LENGTH = 5000;
const MAX_LIST_ITEMS = 30;
const MAX_LIST_ITEM_LENGTH = 100;

/**
 * Limits for the learner-supplied resume sections.
 *
 * These are generous on purpose: the point of the intake is to capture a real
 * work history, and a learner with eight past jobs must not be told to delete
 * one. They exist to bound a payload, not to shape a resume.
 */
const MAX_TARGET_ROLE_LENGTH = 120;
const MAX_INTAKE_ANSWERS = 7;
const MAX_INTAKE_ANSWER_LENGTH = 1500;

const MAX_EXPERIENCE_ENTRIES = 10;
const MAX_EDUCATION_ENTRIES = 6;
const MAX_PROJECT_ENTRIES = 8;
const MAX_CERTIFICATION_ENTRIES = 10;
const MAX_ENTRY_FIELD_LENGTH = 150;
/** Free text such as "summer 2022" — never parsed as a date. */
const MAX_DATE_TEXT_LENGTH = 40;
const MAX_BULLETS_PER_ENTRY = 6;
const MAX_BULLET_LENGTH = 300;
const MAX_DETAIL_LENGTH = 500;
const MAX_PHONE_LENGTH = 40;
const MAX_CITY_LENGTH = 120;
const MAX_LINKS = 5;
const MAX_LINK_LABEL_LENGTH = 40;
const MAX_LINK_URL_LENGTH = 300;

/**
 * Validates one of the two string-array fields, returning either the cleaned
 * array or a human-readable reason it was rejected.
 */
function validateStringList(
  value: unknown,
  fieldName: string
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: `${fieldName} must be an array` };
  }
  if (value.length === 0) {
    return { ok: false, error: `${fieldName} must contain at least one entry` };
  }
  if (value.length > MAX_LIST_ITEMS) {
    return { ok: false, error: `${fieldName} may contain at most ${MAX_LIST_ITEMS} entries` };
  }

  const cleaned: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return { ok: false, error: `${fieldName} must contain only strings` };
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: `${fieldName} must not contain empty entries` };
    }
    if (trimmed.length > MAX_LIST_ITEM_LENGTH) {
      return {
        ok: false,
        error: `Each ${fieldName} entry must be ${MAX_LIST_ITEM_LENGTH} characters or fewer`,
      };
    }
    cleaned.push(trimmed);
  }

  return { ok: true, value: cleaned };
}

type FieldKind = 'text' | 'date' | 'detail' | 'bool' | 'bullets';

interface FieldSpec {
  key: string;
  kind: FieldKind;
  /** A required field must be a non-empty string; everything else may be null. */
  required?: boolean;
}

const FIELD_MAX_LENGTH: Record<Exclude<FieldKind, 'bool' | 'bullets'>, number> = {
  text: MAX_ENTRY_FIELD_LENGTH,
  date: MAX_DATE_TEXT_LENGTH,
  detail: MAX_DETAIL_LENGTH,
};

/**
 * Validates one array of resume entries against a per-field spec.
 *
 * One helper rather than four near-identical validators for experience,
 * education, projects and certifications — they differ only in their fields.
 * Unknown keys are dropped rather than rejected: the client sends back what it
 * was given, and the stored JSON should hold only what we describe here.
 */
function validateEntryList<T>(
  value: unknown,
  fieldName: string,
  maxEntries: number,
  spec: FieldSpec[]
): { ok: true; value: T[] } | { ok: false; error: string } {
  // Absent is not an error: these sections are optional, and a profile saved
  // before the intake existed has none of them.
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: `${fieldName} must be an array` };
  }
  if (value.length > maxEntries) {
    return { ok: false, error: `${fieldName} may contain at most ${maxEntries} entries` };
  }

  const cleaned: Record<string, unknown>[] = [];

  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, error: `${fieldName} must contain only objects` };
    }
    const entry = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const field of spec) {
      const supplied = entry[field.key];

      if (field.kind === 'bool') {
        out[field.key] = Boolean(supplied);
        continue;
      }

      if (field.kind === 'bullets') {
        if (supplied === undefined || supplied === null) {
          out[field.key] = [];
          continue;
        }
        if (!Array.isArray(supplied)) {
          return { ok: false, error: `${fieldName}: ${field.key} must be an array` };
        }
        if (supplied.length > MAX_BULLETS_PER_ENTRY) {
          return {
            ok: false,
            error: `${fieldName}: at most ${MAX_BULLETS_PER_ENTRY} bullet points per entry`,
          };
        }
        const bullets: string[] = [];
        for (const bullet of supplied) {
          if (typeof bullet !== 'string') {
            return { ok: false, error: `${fieldName}: ${field.key} must contain only strings` };
          }
          const trimmed = bullet.trim();
          if (trimmed.length === 0) continue;
          if (trimmed.length > MAX_BULLET_LENGTH) {
            return {
              ok: false,
              error: `${fieldName}: each bullet point must be ${MAX_BULLET_LENGTH} characters or fewer`,
            };
          }
          bullets.push(trimmed);
        }
        out[field.key] = bullets;
        continue;
      }

      const max = FIELD_MAX_LENGTH[field.kind];

      if (supplied === undefined || supplied === null || supplied === '') {
        if (field.required) {
          return { ok: false, error: `${fieldName}: ${field.key} is required` };
        }
        out[field.key] = null;
        continue;
      }
      if (typeof supplied !== 'string') {
        return { ok: false, error: `${fieldName}: ${field.key} must be a string` };
      }
      const trimmed = supplied.trim();
      if (field.required && trimmed.length === 0) {
        return { ok: false, error: `${fieldName}: ${field.key} is required` };
      }
      if (trimmed.length > max) {
        return {
          ok: false,
          error: `${fieldName}: ${field.key} must be ${max} characters or fewer`,
        };
      }
      out[field.key] = trimmed.length > 0 ? trimmed : null;
    }

    cleaned.push(out);
  }

  // The spec above is the schema: `cleaned` holds exactly the keys it names,
  // with the kinds it declares, which is what T describes.
  return { ok: true, value: cleaned as T[] };
}

const EXPERIENCE_SPEC: FieldSpec[] = [
  { key: 'role', kind: 'text', required: true },
  { key: 'employer', kind: 'text', required: true },
  { key: 'location', kind: 'text' },
  { key: 'start', kind: 'date', required: true },
  { key: 'end', kind: 'date' },
  { key: 'current', kind: 'bool' },
  { key: 'bullets', kind: 'bullets' },
];

const EDUCATION_SPEC: FieldSpec[] = [
  { key: 'credential', kind: 'text', required: true },
  // Not required: "finished high school in 2019" names no institution and is
  // still a true entry. Demanding one here would either block the save or
  // invite the learner to make a school up.
  { key: 'institution', kind: 'text' },
  { key: 'location', kind: 'text' },
  { key: 'start', kind: 'date' },
  { key: 'end', kind: 'date' },
  { key: 'detail', kind: 'detail' },
];

const PROJECT_SPEC: FieldSpec[] = [
  { key: 'name', kind: 'text', required: true },
  { key: 'detail', kind: 'detail' },
  { key: 'link', kind: 'detail' },
];

const CERTIFICATION_SPEC: FieldSpec[] = [
  { key: 'name', kind: 'text', required: true },
  { key: 'issuer', kind: 'text' },
  { key: 'issued', kind: 'date' },
];

/**
 * Validates the learner's links.
 *
 * The scheme check is a security control, not tidiness: these URLs are rendered
 * as anchors on the resume, so `javascript:` or `data:` here would be stored
 * XSS. Only http and https are ever accepted.
 */
function validateLinks(
  value: unknown
): { ok: true; value: { label: string; url: string }[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: 'links must be an array' };
  if (value.length > MAX_LINKS) {
    return { ok: false, error: `You may add at most ${MAX_LINKS} links` };
  }

  const cleaned: { label: string; url: string }[] = [];

  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: 'links must contain only objects' };
    }
    const { label, url } = raw as Record<string, unknown>;
    if (typeof label !== 'string' || typeof url !== 'string') {
      return { ok: false, error: 'each link needs a label and a url' };
    }
    const trimmedLabel = label.trim();
    const trimmedUrl = url.trim();
    if (trimmedLabel.length === 0 || trimmedUrl.length === 0) continue;
    if (trimmedLabel.length > MAX_LINK_LABEL_LENGTH) {
      return {
        ok: false,
        error: `A link label must be ${MAX_LINK_LABEL_LENGTH} characters or fewer`,
      };
    }
    if (trimmedUrl.length > MAX_LINK_URL_LENGTH) {
      return { ok: false, error: `A link must be ${MAX_LINK_URL_LENGTH} characters or fewer` };
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmedUrl);
    } catch {
      return { ok: false, error: `"${trimmedUrl}" is not a valid link` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Links must start with http:// or https://' };
    }

    cleaned.push({ label: trimmedLabel, url: trimmedUrl });
  }

  return { ok: true, value: cleaned };
}

/** Trims an optional short text field, returning null when it is absent. */
function optionalText(
  value: unknown,
  fieldName: string,
  max: number
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${fieldName} must be a string` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > max) {
    return { ok: false, error: `${fieldName} must be ${max} characters or fewer` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Reduces a saved profile to what the intake planner needs: which sections are
 * already filled, as counts rather than contents. The planner only has to know
 * whether a gap exists, and sending every stored entry would cost tokens for
 * nothing.
 */
function toCoverage(profile: CareerProfile): ProfileCoverage {
  return {
    headline: profile.headline,
    summary: profile.summary,
    skills: profile.skills,
    experienceCount: profile.experience.length,
    educationCount: profile.education.length,
    projectCount: profile.projects.length,
    certificationCount: profile.certifications.length,
    hasPhone: Boolean(profile.phone),
    hasCity: Boolean(profile.city),
    linkCount: profile.links.length,
  };
}

export class ProfileController {
  /**
   * Returns the caller's profile, or `data: null` when they have none.
   *
   * Deliberately 200-with-null rather than 404: having no profile yet is the
   * normal starting state for every user, not an error. A 404 would force the
   * client to treat a first visit as a failure and would show up as noise in
   * any error monitoring.
   */
  static async getProfile(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const profile = await CareerProfileModel.findByUserId(userId);

      res.json({
        success: true,
        data: profile,
      });
    } catch (error: any) {
      logger.error('Get career profile error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Generates a draft profile from a quiz attempt — WITHOUT persisting it.
   *
   * This deviates from every other Gemini path in this codebase, which writes
   * its result immediately. It is intentional: a learner may already have a
   * profile they have edited by hand, and silently overwriting that text with a
   * fresh draft would destroy work they cannot recover. The draft is returned
   * for the client to show, and only an explicit PUT /api/profile saves it.
   * Please do not "fix" this by persisting here.
   */
  static async generateDraft(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const { attemptId } = req.body;

      if (attemptId === undefined || attemptId === null || attemptId === '') {
        return res.status(400).json({
          success: false,
          error: 'attemptId is required',
        });
      }

      const attemptIdNum = Number(attemptId);
      if (!Number.isInteger(attemptIdNum) || attemptIdNum <= 0) {
        return res.status(400).json({
          success: false,
          error: 'attemptId must be a positive integer',
        });
      }

      const attempt = await QuizAttemptModel.findById(attemptIdNum);

      if (!attempt) {
        return res.status(404).json({
          success: false,
          error: 'Quiz attempt not found',
        });
      }

      // The only place another user's data could enter a draft. Without this,
      // any learner could generate a profile from someone else's attempt.
      if (attempt.user_id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
        });
      }

      if (attempt.percentage_score < CAREER_PROFILE_THRESHOLD) {
        return res.status(400).json({
          success: false,
          error: `A career profile requires a quiz score of ${CAREER_PROFILE_THRESHOLD}% or higher`,
        });
      }

      const [summary, video] = await Promise.all([
        SummaryModel.findByVideoId(attempt.video_id),
        VideoModel.findById(attempt.video_id),
      ]);

      // summary_status can be pending or failed, and the CTA cannot know that
      // in advance — so this is a normal outcome the client must handle.
      if (!summary) {
        return res.status(400).json({
          success: false,
          error: 'Video summary unavailable for profile generation',
        });
      }

      const user = await UserModel.findById(userId);

      const draft = await GeminiCareerProfileService.generateProfileDraft(
        user?.full_name ?? '',
        summary.summary_text,
        summary.key_points,
        video?.category ?? null,
        attempt.percentage_score
      );

      res.json({
        success: true,
        data: {
          headline: draft.headline,
          summary: draft.summary,
          skills: draft.skills,
          jobTitles: draft.job_titles,
          sourceVideoId: attempt.video_id,
          sourceAttemptId: attempt.id,
          generatedLanguage: 'en',
        },
      });
    } catch (error: any) {
      logger.error('Generate career profile draft error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate career profile',
        message: 'An error occurred while drafting your profile. Please try again.',
      });
    }
  }

  /**
   * Saves the caller's profile. Always marks it as edited: anything arriving
   * here came through the form, whether or not the learner changed the draft,
   * and that is what guards against a later regeneration overwriting it.
   */
  static async saveProfile(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const {
        headline,
        summary,
        skills,
        jobTitles,
        experience,
        education,
        projects,
        certifications,
        phone,
        city,
        links,
        sourceVideoId,
        sourceAttemptId,
      } = req.body;

      if (typeof headline !== 'string' || typeof summary !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'headline and summary must be strings',
        });
      }

      const trimmedHeadline = headline.trim();
      const trimmedSummary = summary.trim();

      if (trimmedHeadline.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'headline is required',
        });
      }
      if (trimmedHeadline.length > MAX_HEADLINE_LENGTH) {
        return res.status(400).json({
          success: false,
          error: `headline must be ${MAX_HEADLINE_LENGTH} characters or fewer`,
        });
      }
      if (trimmedSummary.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'summary is required',
        });
      }
      if (trimmedSummary.length > MAX_SUMMARY_LENGTH) {
        return res.status(400).json({
          success: false,
          error: `summary must be ${MAX_SUMMARY_LENGTH} characters or fewer`,
        });
      }

      const skillsResult = validateStringList(skills, 'skills');
      if (!skillsResult.ok) {
        return res.status(400).json({ success: false, error: skillsResult.error });
      }

      const jobTitlesResult = validateStringList(jobTitles, 'jobTitles');
      if (!jobTitlesResult.ok) {
        return res.status(400).json({ success: false, error: jobTitlesResult.error });
      }

      // Every resume section is optional and absent-tolerant: a client that
      // never sends them (or a learner who answered nothing) saves an empty
      // section rather than an error. A section that IS present but malformed
      // is still rejected.
      const experienceResult = validateEntryList<ResumeExperience>(
        experience,
        'experience',
        MAX_EXPERIENCE_ENTRIES,
        EXPERIENCE_SPEC
      );
      if (!experienceResult.ok) {
        return res.status(400).json({ success: false, error: experienceResult.error });
      }

      const educationResult = validateEntryList<ResumeEducation>(
        education,
        'education',
        MAX_EDUCATION_ENTRIES,
        EDUCATION_SPEC
      );
      if (!educationResult.ok) {
        return res.status(400).json({ success: false, error: educationResult.error });
      }

      const projectsResult = validateEntryList<ResumeProject>(
        projects,
        'projects',
        MAX_PROJECT_ENTRIES,
        PROJECT_SPEC
      );
      if (!projectsResult.ok) {
        return res.status(400).json({ success: false, error: projectsResult.error });
      }

      const certificationsResult = validateEntryList<ResumeCertification>(
        certifications,
        'certifications',
        MAX_CERTIFICATION_ENTRIES,
        CERTIFICATION_SPEC
      );
      if (!certificationsResult.ok) {
        return res.status(400).json({ success: false, error: certificationsResult.error });
      }

      const linksResult = validateLinks(links);
      if (!linksResult.ok) {
        return res.status(400).json({ success: false, error: linksResult.error });
      }

      const phoneResult = optionalText(phone, 'phone', MAX_PHONE_LENGTH);
      if (!phoneResult.ok) {
        return res.status(400).json({ success: false, error: phoneResult.error });
      }

      const cityResult = optionalText(city, 'city', MAX_CITY_LENGTH);
      if (!cityResult.ok) {
        return res.status(400).json({ success: false, error: cityResult.error });
      }

      const toOptionalId = (value: unknown): number | null => {
        if (value === undefined || value === null || value === '') return null;
        const num = Number(value);
        return Number.isInteger(num) && num > 0 ? num : null;
      };

      const profile = await CareerProfileModel.upsert({
        user_id: userId,
        headline: trimmedHeadline,
        summary: trimmedSummary,
        skills: skillsResult.value,
        job_titles: jobTitlesResult.value,
        experience: experienceResult.value,
        education: educationResult.value,
        projects: projectsResult.value,
        certifications: certificationsResult.value,
        phone: phoneResult.value,
        city: cityResult.value,
        links: linksResult.value,
        source_video_id: toOptionalId(sourceVideoId),
        source_attempt_id: toOptionalId(sourceAttemptId),
        generated_language: 'en',
        is_edited: true,
      });

      logger.info(`Career profile saved for user ${userId}`);

      res.json({
        success: true,
        data: profile,
      });
    } catch (error: any) {
      logger.error('Save career profile error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Plans the intake questions for a target role.
   *
   * The learner must already have a saved profile: the questions are chosen
   * against what is already on file, and there is nothing to add sections to
   * otherwise.
   */
  static async planIntake(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const { targetRole } = req.body;

      if (typeof targetRole !== 'string' || targetRole.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'targetRole is required',
        });
      }
      const trimmedRole = targetRole.trim();
      if (trimmedRole.length > MAX_TARGET_ROLE_LENGTH) {
        return res.status(400).json({
          success: false,
          error: `targetRole must be ${MAX_TARGET_ROLE_LENGTH} characters or fewer`,
        });
      }

      const profile = await CareerProfileModel.findByUserId(userId);
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'Save a career profile before adding resume details',
        });
      }

      const { questions } = await GeminiIntakeService.planQuestions(
        trimmedRole,
        toCoverage(profile)
      );

      res.json({
        success: true,
        data: { targetRole: trimmedRole, questions },
      });
    } catch (error: any) {
      logger.error('Plan resume intake error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to plan resume intake',
        message: 'An error occurred while preparing your questions. Please try again.',
      });
    }
  }

  /**
   * Structures the learner's intake answers into resume sections — WITHOUT
   * persisting them, for the same reason `generateDraft` does not persist: the
   * learner reviews and corrects the result before it becomes their resume.
   * That review is the last line of defence against the model embellishing an
   * answer, so it must not be bypassed by saving here.
   */
  static async draftFromIntake(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const { targetRole, answers } = req.body;

      if (typeof targetRole !== 'string' || targetRole.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'targetRole is required' });
      }
      const trimmedRole = targetRole.trim();
      if (trimmedRole.length > MAX_TARGET_ROLE_LENGTH) {
        return res.status(400).json({
          success: false,
          error: `targetRole must be ${MAX_TARGET_ROLE_LENGTH} characters or fewer`,
        });
      }

      if (!Array.isArray(answers) || answers.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'answers must be a non-empty array',
        });
      }
      if (answers.length > MAX_INTAKE_ANSWERS) {
        return res.status(400).json({
          success: false,
          error: `answers may contain at most ${MAX_INTAKE_ANSWERS} entries`,
        });
      }

      // The client echoes back the question it was given. None of this is
      // persisted — it only assembles the prompt — but it is still bounded and
      // type-checked so a malformed body cannot reach Gemini.
      const cleanedAnswers: IntakeAnswer[] = [];
      for (const raw of answers) {
        if (typeof raw !== 'object' || raw === null) {
          return res.status(400).json({
            success: false,
            error: 'answers must contain only objects',
          });
        }
        const { id, section, prompt, answer } = raw as Record<string, unknown>;
        if (
          typeof id !== 'string' ||
          typeof prompt !== 'string' ||
          typeof answer !== 'string' ||
          typeof section !== 'string'
        ) {
          return res.status(400).json({
            success: false,
            error: 'each answer needs id, section, prompt and answer strings',
          });
        }
        if (!INTAKE_SECTIONS.includes(section as IntakeSection)) {
          return res.status(400).json({
            success: false,
            error: `section must be one of: ${INTAKE_SECTIONS.join(', ')}`,
          });
        }
        const trimmedAnswer = answer.trim();
        // A skipped question arrives empty and simply carries no facts.
        if (trimmedAnswer.length === 0) continue;
        if (trimmedAnswer.length > MAX_INTAKE_ANSWER_LENGTH) {
          return res.status(400).json({
            success: false,
            error: `Each answer must be ${MAX_INTAKE_ANSWER_LENGTH} characters or fewer`,
          });
        }
        cleanedAnswers.push({
          id: id.slice(0, 100),
          section: section as IntakeSection,
          prompt: prompt.slice(0, 300),
          answer: trimmedAnswer,
        });
      }

      if (cleanedAnswers.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Answer at least one question to build your resume',
        });
      }

      const profile = await CareerProfileModel.findByUserId(userId);
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'Save a career profile before adding resume details',
        });
      }

      const user = await UserModel.findById(userId);

      const { draft } = await GeminiIntakeService.structureAnswers(
        user?.full_name ?? '',
        trimmedRole,
        cleanedAnswers,
        toCoverage(profile)
      );

      res.json({
        success: true,
        data: {
          experience: draft.experience,
          education: draft.education,
          projects: draft.projects,
          certifications: draft.certifications,
          phone: draft.phone,
          city: draft.city,
          links: draft.links,
          headline: draft.headline,
          summary: draft.summary,
          skills: draft.skills,
          jobTitles: draft.job_titles,
        },
      });
    } catch (error: any) {
      logger.error('Draft resume from intake error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to build your resume details',
        message: 'An error occurred while organising your answers. Please try again.',
      });
    }
  }

  /**
   * Records that the learner clicked through to a destination's signup page.
   *
   * To be explicit, because the column names invite the wrong reading: this
   * records a CLICK-THROUGH, not a registration. We open the destination in a
   * new tab and copy the profile text to the clipboard; the learner completes
   * signup themselves, on the destination's own site. No job board offers a
   * callback, so completion is unobservable to us. Nothing may ever render this
   * as "connected", a checkmark, or a successful publish — that would be a lie.
   */
  static async recordHandoff(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const { platform } = req.body;

      // Never store a client-supplied free string here.
      if (
        typeof platform !== 'string' ||
        !HANDOFF_PLATFORMS.includes(platform as HandoffPlatform)
      ) {
        return res.status(400).json({
          success: false,
          error: `platform must be one of: ${HANDOFF_PLATFORMS.join(', ')}`,
        });
      }

      const profile = await CareerProfileModel.findByUserId(userId);

      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'No career profile to hand off',
        });
      }

      await CareerProfileModel.recordHandoff(userId, platform as HandoffPlatform);

      res.json({
        success: true,
        data: { platform },
      });
    } catch (error: any) {
      logger.error('Record career profile handoff error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

export default ProfileController;
