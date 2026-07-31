import { Request, Response } from 'express';
import { VideoModel } from '../models/Video';
import { ApiResponse } from '../types';
import logger from '../utils/logger';
import { GeminiQuizService } from '../services/gemini-quiz.service';
import { GeminiChatService } from '../services/gemini-chat.service';
import { TranscriptionModel } from '../models/Transcription';
import { SummaryModel } from '../models/Summary';
import { QuizModel } from '../models/Quiz';
import { toPublicQuestion } from '../types/quiz.types';
import { geminiModel } from '../config/gemini';

// The frontend already limits input to 1000 characters; this enforces it
// server-side so token spend per request is bounded.
const MAX_CHAT_QUESTION_CHARS = 2000;
const MAX_CHAT_HISTORY_MESSAGES = 20;

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
      const { videoId, regenerate } = req.body;

      if (!videoId) {
        return res.status(400).json({
          success: false,
          error: 'Video ID is required',
        });
      }

      const videoIdNum = parseInt(videoId);

      if (Number.isNaN(videoIdNum)) {
        return res.status(400).json({
          success: false,
          error: 'Video ID must be a number',
        });
      }

      // Serve a cached quiz when one exists. Previously every quiz page load
      // triggered a fresh (paid) Gemini call.
      if (!regenerate) {
        const cached = await QuizModel.findLatestByVideo(videoIdNum);
        if (cached) {
          logger.info(`Serving cached quiz ${cached.id} for video ${videoIdNum}`);
          return res.json({
            success: true,
            data: {
              quizId: cached.id,
              questions: cached.questions.map(toPublicQuestion),
              cached: true,
            },
          });
        }
      }

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

      // Persist the full quiz (including the answer key) server-side, along
      // with what it cost to generate.
      const quizId = await QuizModel.create(videoIdNum, quizData.questions, {
        tokensUsed: quizData.tokens_used,
        modelUsed: geminiModel,
      });

      logger.info(
        `Quiz ${quizId} generated for video ${videoIdNum}. Questions: ${quizData.questions.length}, Tokens: ${quizData.tokens_used}`
      );

      res.json({
        success: true,
        data: {
          quizId,
          // correctAnswer and explanation are deliberately withheld until the
          // user submits — see validateQuiz.
          questions: quizData.questions.map(toPublicQuestion),
          tokensUsed: quizData.tokens_used,
          cached: false,
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
      const { quizId, userAnswers } = req.body;

      if (!quizId || !userAnswers) {
        return res.status(400).json({
          success: false,
          error: 'quizId and userAnswers are required',
        });
      }

      if (!Array.isArray(userAnswers)) {
        return res.status(400).json({
          success: false,
          error: 'userAnswers must be an array',
        });
      }

      // The answer key is loaded from the database, never from the request
      // body. A client can no longer submit fabricated questions to grade
      // itself against.
      const quiz = await QuizModel.findById(parseInt(quizId));

      if (!quiz) {
        return res.status(404).json({
          success: false,
          error: 'Quiz not found',
        });
      }

      if (userAnswers.length !== quiz.questions.length) {
        return res.status(400).json({
          success: false,
          error: `Expected ${quiz.questions.length} answers, received ${userAnswers.length}`,
        });
      }

      const validationResult = GeminiQuizService.gradeAnswers(
        quiz.questions,
        userAnswers
      );

      res.json({
        success: true,
        data: validationResult,
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

  static async chat(req: Request, res: Response<ApiResponse>) {
    try {
      const { question, conversationHistory } = req.body;

      if (!question || typeof question !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Question is required and must be a string',
        });
      }

      if (question.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Question cannot be empty',
        });
      }

      if (question.length > MAX_CHAT_QUESTION_CHARS) {
        return res.status(400).json({
          success: false,
          error: `Question must be ${MAX_CHAT_QUESTION_CHARS} characters or fewer`,
        });
      }

      // Optional conversation history for context. Capped to the most recent
      // turns: the client previously controlled how much history was replayed
      // into the prompt, and therefore how many tokens each request cost.
      const history = Array.isArray(conversationHistory)
        ? conversationHistory.slice(-MAX_CHAT_HISTORY_MESSAGES)
        : [];

      // Get chat response from Gemini
      const chatResult = await GeminiChatService.chat(question, history);

      logger.info(
        `Chat response generated. Tokens used: ${chatResult.tokens_used}`
      );

      res.json({
        success: true,
        data: {
          response: chatResult.response,
          tokensUsed: chatResult.tokens_used,
        },
      });
    } catch (error: any) {
      logger.error('Chat error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to process chat',
        message:
          'An error occurred while processing your question. Please try again.',
      });
    }
  }
}

export default AIController;
