import { Request, Response } from 'express';
import { VideoModel } from '../models/Video';
import { ApiResponse } from '../types';
import logger from '../utils/logger';
import { GeminiQuizService } from '../services/gemini-quiz.service';
import { TranscriptionModel } from '../models/Transcription';
import { SummaryModel } from '../models/Summary';

export class AIController {
  static async getStatus(req: Request, res: Response<ApiResponse>) {
    try {
      const videoId = parseInt(req.params.videoId);

      const video = await VideoModel.findById(videoId);

      if (!video) {
        return res.status(404).json({
          success: false,
          error: 'Video not found',
        });
      }

      res.json({
        success: true,
        data: {
          compression_status: video.compression_status,
          transcription_status: video.transcription_status,
          summary_status: video.summary_status,
        },
      });
    } catch (error: any) {
      logger.error('Get AI status error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async generateQuiz(req: Request, res: Response<ApiResponse>) {
    try {
      const { videoId } = req.body;

      if (!videoId) {
        return res.status(400).json({
          success: false,
          error: 'Video ID is required',
        });
      }

      const videoIdNum = parseInt(videoId);

      // Fetch transcript and summary
      const transcription = await TranscriptionModel.findByVideoId(videoIdNum);
      const summary = await SummaryModel.findByVideoId(videoIdNum);

      if (!transcription || !summary) {
        return res.status(400).json({
          success: false,
          error: 'Video must have transcript and summary to generate quiz',
          message:
            'Please wait for the video to be fully processed before taking the quiz',
        });
      }

      // Generate quiz using Gemini
      const quizData = await GeminiQuizService.generateQuiz(
        transcription.transcript_text,
        summary.summary_text,
        summary.key_points
      );

      logger.info(
        `Quiz generated for video ${videoIdNum}. Questions: ${quizData.questions.length}, Tokens: ${quizData.tokens_used}`
      );

      res.json({
        success: true,
        data: {
          questions: quizData.questions,
          tokensUsed: quizData.tokens_used,
        },
      });
    } catch (error: any) {
      logger.error('Quiz generation error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate quiz',
        message: 'An error occurred while generating the quiz. Please try again.',
      });
    }
  }

  static async validateQuiz(req: Request, res: Response<ApiResponse>) {
    try {
      const { questions, userAnswers } = req.body;

      if (!questions || !userAnswers) {
        return res.status(400).json({
          success: false,
          error: 'Questions and user answers are required',
        });
      }

      if (!Array.isArray(questions) || !Array.isArray(userAnswers)) {
        return res.status(400).json({
          success: false,
          error: 'Questions and userAnswers must be arrays',
        });
      }

      if (questions.length !== 5 || userAnswers.length !== 5) {
        return res.status(400).json({
          success: false,
          error: 'Quiz must have exactly 5 questions and answers',
        });
      }

      // Validate answers using Gemini
      const validationResult = await GeminiQuizService.validateAnswers(
        questions,
        userAnswers
      );

      logger.info(
        `Quiz validated. Score: ${validationResult.score}/${validationResult.totalQuestions}, Tokens: ${validationResult.tokens_used}`
      );

      res.json({
        success: true,
        data: {
          results: validationResult.results,
          score: validationResult.score,
          totalQuestions: validationResult.totalQuestions,
          percentageScore: validationResult.percentageScore,
        },
      });
    } catch (error: any) {
      logger.error('Quiz validation error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to validate quiz',
        message:
          'An error occurred while validating your answers. Please try again.',
      });
    }
  }
}

export default AIController;
