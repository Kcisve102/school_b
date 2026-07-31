import { geminiClient, geminiModel } from '../config/gemini';
import { createUserContent, Type } from '@google/genai';
import logger from '../utils/logger';
import { retryGeminiCall } from '../utils/gemini-errors';
import {
  Question,
  UserAnswer,
  QuizResult,
  ValidationResponse,
  GeminiQuizResponse,
} from '../types/quiz.types';

// JSON Schema for quiz generation output
const quizGenerationSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      description: 'Array of exactly 5 quiz questions',
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.INTEGER,
            description: 'Sequential question ID (1-5)',
          },
          question: {
            type: Type.STRING,
            description: 'Clear, specific question about the video content',
          },
          options: {
            type: Type.ARRAY,
            description: 'Array of exactly 4 answer options',
            items: {
              type: Type.STRING,
            },
            minItems: 4,
            maxItems: 4,
          },
          correctAnswer: {
            type: Type.INTEGER,
            description: 'Index of the correct option (0-3)',
          },
          explanation: {
            type: Type.STRING,
            description: 'Brief explanation of why this answer is correct',
          },
        },
        required: ['id', 'question', 'options', 'correctAnswer', 'explanation'],
      },
      minItems: 5,
      maxItems: 5,
    },
  },
  required: ['questions'],
};

/**
 * Gemini 2.5 Flash holds roughly a 1M-token context; a 2-hour lecture
 * transcript is only ~30-50k tokens, so the full text virtually always fits.
 *
 * This replaces a hard `substring(0, 5000)` cut, which meant quizzes for any
 * video longer than a few minutes were generated purely from its opening.
 * The guard below only engages on extreme outliers, and keeps the head *and*
 * tail so the end of the video is still represented.
 */
const MAX_TRANSCRIPT_CHARS = 200_000;

function capTranscript(transcript: string): string {
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;

  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  const head = transcript.slice(0, half);
  const tail = transcript.slice(-half);
  return `${head}\n\n[... middle section omitted for length ...]\n\n${tail}`;
}

export class GeminiQuizService {
  /**
   * Generate a 5-question quiz based on video transcript and summary
   * @param transcript - Full transcript text
   * @param summary - Video summary text
   * @param keyPoints - Array of key points from summary
   * @returns Quiz with 5 questions and token usage
   */
  static async generateQuiz(
    transcript: string,
    summary: string,
    keyPoints: string[]
  ): Promise<GeminiQuizResponse> {
    try {
      logger.info('Starting Gemini quiz generation...');

      const prompt = `You are an expert educational content creator specializing in creating effective comprehension quizzes. Write all output in Simplified Chinese (中文简体).

Based on the following video content, create a quiz with EXACTLY 5 multiple-choice questions to test viewer comprehension.

VIDEO SUMMARY:
${summary}

KEY POINTS:
${keyPoints.map((point, idx) => `${idx + 1}. ${point}`).join('\n')}

FULL TRANSCRIPT:
${capTranscript(transcript)}

REQUIREMENTS:
1. Create EXACTLY 5 questions covering the main concepts
2. Draw questions from across the WHOLE video, not just the opening — at least one question must come from the final third
3. Each question must have exactly 4 options (A, B, C, D)
4. Questions should range from basic recall to deeper understanding
5. Include at least one question about the main topic/theme
6. Include questions about specific details from the transcript
7. Make wrong options plausible but clearly incorrect
8. Provide clear explanations for the correct answers
9. Vary question difficulty: 2 easy, 2 medium, 1 challenging
10. Write all questions, options, and explanations in Chinese

Ensure questions are clear, specific, and directly related to the video content.`;

      const response = await retryGeminiCall(async () => {
        return await geminiClient.models.generateContent({
          model: geminiModel,
          contents: createUserContent([prompt]),
          config: {
            responseMimeType: 'application/json',
            responseSchema: quizGenerationSchema,
            temperature: 0.9, // Higher temperature for variety
          },
        });
      });

      if (!response.text) {
        throw new Error('No response text received from Gemini');
      }

      const result = JSON.parse(response.text);

      // Get token count from response metadata
      const tokensUsed: number = response.usageMetadata?.totalTokenCount || 0;

      logger.info(
        `Quiz generation completed. Questions: ${result.questions.length}, Tokens used: ${tokensUsed}`
      );

      return {
        questions: result.questions,
        tokens_used: tokensUsed,
      };
    } catch (error: any) {
      logger.error('Gemini quiz generation error:', error);
      throw new Error(`Quiz generation failed: ${error.message}`);
    }
  }

  /**
   * Grade user answers against the stored answer key.
   *
   * This is deliberately NOT an AI call. Grading a multiple-choice quiz is an
   * integer comparison; the previous implementation asked Gemini to decide
   * whether `selectedOption === correctAnswer` at temperature 0.3, which was
   * slow, cost tokens on every submission, and could return a score that
   * disagreed with its own per-question verdicts.
   *
   * Explanations come from the stored quiz, so no model call is needed here.
   *
   * @param questions - Questions loaded from the `quizzes` table (never from the client)
   * @param userAnswers - User's selected option indices
   */
  static gradeAnswers(
    questions: Question[],
    userAnswers: UserAnswer[]
  ): ValidationResponse {
    const results: QuizResult[] = questions.map((question) => {
      const userAnswer = userAnswers.find((ua) => ua.questionId === question.id);
      const selectedOption = userAnswer?.selectedOption ?? -1;

      return {
        questionId: question.id,
        isCorrect: selectedOption === question.correctAnswer,
        explanation: question.explanation,
        correctAnswer: question.options[question.correctAnswer] ?? '',
      };
    });

    const score = results.filter((result) => result.isCorrect).length;
    const totalQuestions = questions.length;
    const percentageScore =
      totalQuestions > 0
        ? Math.round((score / totalQuestions) * 100 * 100) / 100
        : 0;

    logger.info(`Quiz graded server-side. Score: ${score}/${totalQuestions}`);

    return { results, score, totalQuestions, percentageScore };
  }
}

export default GeminiQuizService;
