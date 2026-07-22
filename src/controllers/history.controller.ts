/// <reference path="../types/express-session.d.ts" />
import { Request, Response } from 'express';
import axios from 'axios';
import { ApiResponse } from '../types';
import logger from '../utils/logger';
import { VideoWatchModel } from '../models/VideoWatch';
import { QuizAttemptModel } from '../models/QuizAttempt';
import { VideoModel } from '../models/Video';
import { SummaryModel } from '../models/Summary';
import { GeminiJobService } from '../services/gemini-job.service';
import { JobSuggestion, JobSuggestionWithStatus } from '../types/job.types';

const JOB_SUGGESTION_THRESHOLD = 0;

async function getVideoJobContext(videoId: number) {
  const [summary, video] = await Promise.all([
    SummaryModel.findByVideoId(videoId),
    VideoModel.findById(videoId),
  ]);
  return { summary, video };
}

async function checkUrlStatus(url: string): Promise<'active' | 'unavailable'> {
  const timeout = 5000;
  try {
    const headResponse = await axios.head(url, { timeout, validateStatus: () => true });
    if (headResponse.status >= 200 && headResponse.status < 300) {
      return 'active';
    }
  } catch {
    // fall through to GET
  }

  try {
    const getResponse = await axios.get(url, { timeout, validateStatus: () => true });
    return getResponse.status >= 200 && getResponse.status < 300 ? 'active' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export class HistoryController {
  static async recordWatch(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const { videoId } = req.body;

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

      await VideoWatchModel.upsert(userId, videoIdNum);

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

  static async recordQuizAttempt(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = req.session.userId!;
      const { videoId, questions, results, score, totalQuestions, percentageScore } = req.body;

      if (
        !videoId ||
        !questions ||
        !results ||
        score == null ||
        !totalQuestions ||
        percentageScore == null
      ) {
        return res.status(400).json({
          success: false,
          error: 'Missing required quiz attempt fields',
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

      const attemptId = await QuizAttemptModel.create({
        user_id: userId,
        video_id: videoIdNum,
        questions,
        results,
        score,
        total_questions: totalQuestions,
        percentage_score: percentageScore,
      });

      logger.info(
        `Quiz attempt ${attemptId} recorded for user ${userId}, video ${videoIdNum}, score ${score}/${totalQuestions}`
      );

      res.json({
        success: true,
        data: { attemptId },
      });

      // Fire-and-forget: pre-generate job suggestions so history already has
      // them populated on next view, without delaying this response.
      if (percentageScore >= JOB_SUGGESTION_THRESHOLD) {
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

  static async checkJobValidity(req: Request, res: Response<ApiResponse>) {
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

      const jobs = attempt.job_suggestions ?? [];

      if (jobs.length === 0) {
        return res.json({ success: true, data: { jobs: [] } });
      }

      const checked: JobSuggestionWithStatus[] = await Promise.all(
        jobs.map(async (job: JobSuggestion) => {
          const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(job.keywords)}`;
          const status = await checkUrlStatus(url);
          return { ...job, status };
        })
      );

      res.json({
        success: true,
        data: { jobs: checked },
      });
    } catch (error: any) {
      logger.error('Check job validity error:', error);
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
