/// <reference path="../types/express-session.d.ts" />
import { Request, Response } from 'express';
import { ApiResponse } from '../types';
import logger from '../utils/logger';
import { CareerProfileModel } from '../models/CareerProfile';
import { QuizAttemptModel } from '../models/QuizAttempt';
import { VideoModel } from '../models/Video';
import { SummaryModel } from '../models/Summary';
import { UserModel } from '../models/User';
import { GeminiCareerProfileService } from '../services/gemini-career-profile.service';
import { HANDOFF_PLATFORMS, HandoffPlatform } from '../types/profile.types';

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
      const { headline, summary, skills, jobTitles, sourceVideoId, sourceAttemptId } = req.body;

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
