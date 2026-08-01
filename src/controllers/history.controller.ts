/// <reference path="../types/express-session.d.ts" />
import { Request, Response } from 'express';
import { ApiResponse } from '../types';
import logger from '../utils/logger';
import { VideoWatchModel } from '../models/VideoWatch';
import { QuizAttemptModel } from '../models/QuizAttempt';
import { VideoModel } from '../models/Video';
import { SummaryModel } from '../models/Summary';
import { QuizModel } from '../models/Quiz';
import { GeminiJobService } from '../services/gemini-job.service';
import { GeminiQuizService } from '../services/gemini-quiz.service';

const JOB_SUGGESTION_THRESHOLD = 0;

async function getVideoJobContext(videoId: number) {
  const [summary, video] = await Promise.all([
    SummaryModel.findByVideoId(videoId),
    VideoModel.findById(videoId),
  ]);
  return { summary, video };
}

/*
 * Job availability checking was removed deliberately.
 *
 * It probed `indeed.com/jobs?q=<keywords>` — a *search results* page, which
 * returns HTTP 200 whether it matches 500 jobs or none — so "active" never
 * actually meant a job existed. Worse, Indeed serves a 403 anti-bot page to
 * datacenter IPs, and that 403 was mapped to "unavailable", making healthy
 * roles render as dead. Verified against the live site: 403 even with a real
 * browser User-Agent.
 *
 * Gemini suggests a role and keywords rather than a specific posting, so there
 * is no individual listing whose liveness could be checked anyway. Showing no
 * badge is more honest than showing a wrong one. The Indeed and Fiverr links
 * still work and are unaffected.
 *
 * If this signal is wanted later, an official jobs API (Adzuna, JSearch) gives
 * real counts and real postings for the cost of one API key.
 */

export class HistoryController {
  static async recordWatch(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const { videoId, positionSeconds, completed } = req.body;

      if (!videoId) {
        return res.status(400).json({
          success: false,
          error: 'Video ID is required',
        });
      }

      const videoIdNum = parseInt(videoId);
      const video = await VideoModel.findById(videoIdNum);

      if (!video) {
        return res.status(404).json({
          success: false,
          error: 'Video not found',
        });
      }

      // Clamp to the known duration so a bad client can't store a position past
      // the end of the video (which would make it un-resumable).
      const rawPosition = Number(positionSeconds);
      const position = Number.isFinite(rawPosition) && rawPosition > 0
        ? Math.min(rawPosition, video.duration ?? rawPosition)
        : 0;

      await VideoWatchModel.upsert(userId, videoIdNum, position, completed === true);

      res.json({
        success: true,
        data: { videoId: videoIdNum },
      });
    } catch (error: any) {
      logger.error('Record watch error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Where the learner left off in a single video, so the detail page can resume
   * without pulling their whole history.
   */
  static async getWatchProgress(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const videoId = parseInt(req.params.videoId);

      if (Number.isNaN(videoId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid video ID',
        });
      }

      const watch = await VideoWatchModel.findOne(userId, videoId);

      res.json({
        success: true,
        data: {
          positionSeconds: watch?.position_seconds ?? 0,
          // MySQL returns BOOLEAN columns as 0/1; coerce so the JSON matches
          // the boolean the client's type declares.
          completed: Boolean(watch?.completed),
        },
      });
    } catch (error: any) {
      logger.error('Get watch progress error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async recordQuizAttempt(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const { videoId, quizId, userAnswers } = req.body;

      if (!videoId || !quizId || !userAnswers) {
        return res.status(400).json({
          success: false,
          error: 'videoId, quizId and userAnswers are required',
        });
      }

      if (!Array.isArray(userAnswers)) {
        return res.status(400).json({
          success: false,
          error: 'userAnswers must be an array',
        });
      }

      const videoIdNum = parseInt(videoId);
      const video = await VideoModel.findById(videoIdNum);

      if (!video) {
        return res.status(404).json({
          success: false,
          error: 'Video not found',
        });
      }

      const quiz = await QuizModel.findById(parseInt(quizId));

      if (!quiz) {
        return res.status(404).json({
          success: false,
          error: 'Quiz not found',
        });
      }

      if (quiz.video_id !== videoIdNum) {
        return res.status(400).json({
          success: false,
          error: 'Quiz does not belong to this video',
        });
      }

      // Score is recomputed from the stored answer key. Any score supplied by
      // the client is ignored — previously a user could POST a 100% result for
      // a quiz they never took.
      const graded = GeminiQuizService.gradeAnswers(quiz.questions, userAnswers);

      const attemptId = await QuizAttemptModel.create({
        user_id: userId,
        video_id: videoIdNum,
        quiz_id: quiz.id,
        questions: quiz.questions,
        results: graded.results,
        score: graded.score,
        total_questions: graded.totalQuestions,
        percentage_score: graded.percentageScore,
      });

      logger.info(
        `Quiz attempt ${attemptId} recorded for user ${userId}, video ${videoIdNum}, score ${graded.score}/${graded.totalQuestions}`
      );

      res.json({
        success: true,
        data: {
          attemptId,
          results: graded.results,
          score: graded.score,
          totalQuestions: graded.totalQuestions,
          percentageScore: graded.percentageScore,
        },
      });

      // Fire-and-forget: pre-generate job suggestions so history already has
      // them populated on next view, without delaying this response.
      if (graded.percentageScore >= JOB_SUGGESTION_THRESHOLD) {
        (async () => {
          try {
            const { summary, video } = await getVideoJobContext(videoIdNum);
            if (!summary) return;

            const jobResult = await GeminiJobService.generateJobSuggestions(
              summary.summary_text,
              summary.key_points,
              video?.category ?? null
            );
            await QuizAttemptModel.updateJobSuggestions(attemptId, jobResult.jobs);
          } catch (bgError: any) {
            logger.error(`Background job suggestion generation failed for attempt ${attemptId}:`, bgError);
          }
        })();
      }
    } catch (error: any) {
      logger.error('Record quiz attempt error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async getHistory(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;

      const watches = await VideoWatchModel.findAllByUser(userId);
      const attempts = await QuizAttemptModel.findAllByUser(userId);

      const attemptsByVideo = new Map<number, typeof attempts>();
      for (const attempt of attempts) {
        const list = attemptsByVideo.get(attempt.video_id) || [];
        list.push(attempt);
        attemptsByVideo.set(attempt.video_id, list);
      }

      const videoIds = new Set<number>([
        ...watches.map((w) => w.video_id),
        ...attempts.map((a) => a.video_id),
      ]);

      const items = await Promise.all(
        Array.from(videoIds).map(async (videoId) => {
          const video = await VideoModel.findById(videoId);
          const watch = watches.find((w) => w.video_id === videoId);
          const videoAttempts = (attemptsByVideo.get(videoId) || []).map((a) => ({
            id: a.id,
            score: a.score,
            totalQuestions: a.total_questions,
            percentageScore: a.percentage_score,
            createdAt: a.created_at,
            hasJobSuggestions: a.job_suggestions != null,
          }));

          return {
            video,
            watchedAt: watch?.watched_at ?? null,
            positionSeconds: watch?.position_seconds ?? 0,
            completed: Boolean(watch?.completed),
            attempts: videoAttempts,
          };
        })
      );

      items.sort((a, b) => {
        const at = a.watchedAt ? new Date(a.watchedAt).getTime() : 0;
        const bt = b.watchedAt ? new Date(b.watchedAt).getTime() : 0;
        return bt - at;
      });

      res.json({
        success: true,
        data: items,
      });
    } catch (error: any) {
      logger.error('Get history error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async getJobSuggestions(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const attemptId = parseInt(req.params.attemptId);

      const attempt = await QuizAttemptModel.findById(attemptId);

      if (!attempt) {
        return res.status(404).json({
          success: false,
          error: 'Quiz attempt not found',
        });
      }

      if (attempt.user_id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
        });
      }

      if (attempt.percentage_score < JOB_SUGGESTION_THRESHOLD) {
        return res.status(400).json({
          success: false,
          error: `Job suggestions are only available for scores of ${JOB_SUGGESTION_THRESHOLD}% or higher`,
        });
      }

      if (attempt.job_suggestions) {
        return res.json({
          success: true,
          data: { jobs: attempt.job_suggestions, cached: true },
        });
      }

      const { summary, video } = await getVideoJobContext(attempt.video_id);

      if (!summary) {
        return res.status(400).json({
          success: false,
          error: 'Video summary unavailable for job suggestions',
        });
      }

      const jobResult = await GeminiJobService.generateJobSuggestions(
        summary.summary_text,
        summary.key_points,
        video?.category ?? null
      );

      await QuizAttemptModel.updateJobSuggestions(attemptId, jobResult.jobs);

      res.json({
        success: true,
        data: { jobs: jobResult.jobs, cached: false },
      });
    } catch (error: any) {
      logger.error('Get job suggestions error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate job suggestions',
        message: 'An error occurred while finding related jobs. Please try again.',
      });
    }
  }

  static async getQuizAttemptDetail(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const attemptId = parseInt(req.params.attemptId);

      const attempt = await QuizAttemptModel.findById(attemptId);

      if (!attempt) {
        return res.status(404).json({
          success: false,
          error: 'Quiz attempt not found',
        });
      }

      if (attempt.user_id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
        });
      }

      res.json({
        success: true,
        data: {
          id: attempt.id,
          videoId: attempt.video_id,
          questions: attempt.questions,
          results: attempt.results,
          score: attempt.score,
          totalQuestions: attempt.total_questions,
          percentageScore: attempt.percentage_score,
          jobSuggestions: attempt.job_suggestions,
          createdAt: attempt.created_at,
        },
      });
    } catch (error: any) {
      logger.error('Get quiz attempt detail error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async findMoreJobs(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const attemptId = parseInt(req.params.attemptId);

      const attempt = await QuizAttemptModel.findById(attemptId);

      if (!attempt) {
        return res.status(404).json({
          success: false,
          error: 'Quiz attempt not found',
        });
      }

      if (attempt.user_id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
        });
      }

      const { summary, video } = await getVideoJobContext(attempt.video_id);

      if (!summary) {
        return res.status(400).json({
          success: false,
          error: 'Video summary unavailable for job suggestions',
        });
      }

      const existingTitles = (attempt.job_suggestions ?? []).map((j) => j.title);

      const jobResult = await GeminiJobService.generateJobSuggestions(
        summary.summary_text,
        summary.key_points,
        video?.category ?? null,
        existingTitles
      );

      const allJobs = await QuizAttemptModel.appendJobSuggestions(attemptId, jobResult.jobs);

      res.json({
        success: true,
        data: { jobs: allJobs },
      });
    } catch (error: any) {
      logger.error('Find more jobs error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to find more jobs',
        message: 'An error occurred while finding more jobs. Please try again.',
      });
    }
  }
}

export default HistoryController;
