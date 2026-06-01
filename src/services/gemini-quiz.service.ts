import { geminiClient, geminiModel } from '../config/gemini';
import { createUserContent, Type } from '@google/genai';
import logger from '../utils/logger';
import { retryGeminiCall } from '../utils/gemini-errors';
import {
  Question,
  UserAnswer,
  GeminiQuizResponse,
  GeminiValidationResponse,
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

// JSON Schema for answer validation output
const validationSchema = {
  type: Type.OBJECT,
  properties: {
    results: {
      type: Type.ARRAY,
      description: 'Validation results for each question',
      items: {
        type: Type.OBJECT,
        properties: {
          questionId: {
            type: Type.INTEGER,
            description: 'ID of the question being validated',
          },
          isCorrect: {
            type: Type.BOOLEAN,
            description: 'Whether the user answer is correct',
          },
          explanation: {
            type: Type.STRING,
            description: 'Educational explanation about the answer',
          },
          correctAnswer: {
            type: Type.STRING,
            description: 'The text of the correct answer option',
          },
        },
        required: ['questionId', 'isCorrect', 'explanation', 'correctAnswer'],
      },
    },
    score: {
      type: Type.INTEGER,
      description: 'Number of correct answers',
    },
    totalQuestions: {
      type: Type.INTEGER,
      description: 'Total number of questions (always 5)',
    },
    percentageScore: {
      type: Type.NUMBER,
      description: 'Percentage score (0-100)',
    },
  },
  required: ['results', 'score', 'totalQuestions', 'percentageScore'],
};

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
${transcript.substring(0, 5000)}${transcript.length > 5000 ? '...' : ''}

REQUIREMENTS:
1. Create 10-15 questions that cover the main concepts
2. Each question must have exactly 4 options (A, B, C, D)
3. Questions should range from basic recall to deeper understanding
4. Include at least one question about the main topic/theme
5. Include questions about specific details from the transcript
6. Make wrong options plausible but clearly incorrect
7. Provide clear explanations for the correct answers
8. Vary question difficulty (2 easy, 2 medium, 1 challenging)
9. Write all questions, options, and explanations in Chinese

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
   * Validate user answers using AI
   * @param questions - Original quiz questions
   * @param userAnswers - User's selected answers
   * @returns Validation results with score and explanations
   */
  static async validateAnswers(
    questions: Question[],
    userAnswers: UserAnswer[]
  ): Promise<GeminiValidationResponse> {
    try {
      logger.info('Starting Gemini answer validation...');

      // Build validation context
      const questionsContext = questions
        .map((q) => {
          const userAnswer = userAnswers.find((ua) => ua.questionId === q.id);
          const selectedOptionIndex = userAnswer?.selectedOption ?? -1;
          const selectedOptionText =
            selectedOptionIndex >= 0 && selectedOptionIndex < q.options.length
              ? q.options[selectedOptionIndex]
              : 'No answer selected';

          return `
Question ${q.id}: ${q.question}
Options: ${q.options.map((opt, idx) => `${idx}. ${opt}`).join(' | ')}
Correct Answer Index: ${q.correctAnswer}
User Selected Index: ${selectedOptionIndex}
User Selected Text: ${selectedOptionText}
Explanation: ${q.explanation}
`;
        })
        .join('\n---\n');

      const prompt = `You are an expert quiz grader providing educational feedback. Write all explanations and feedback in Simplified Chinese (中文简体).

Review the following quiz questions and user answers. For each question:
1. Determine if the user's answer is correct
2. Provide an educational explanation
3. State the correct answer

QUIZ CONTEXT:
${questionsContext}

REQUIREMENTS:
1. Be fair and accurate in grading
2. Provide helpful explanations for both correct and incorrect answers
3. For incorrect answers, explain why the user's choice was wrong and why the correct answer is right
4. For correct answers, reinforce the key concept
5. Calculate the total score and percentage

Provide educational, encouraging feedback.`;

      const response = await retryGeminiCall(async () => {
        return await geminiClient.models.generateContent({
          model: geminiModel,
          contents: createUserContent([prompt]),
          config: {
            responseMimeType: 'application/json',
            responseSchema: validationSchema,
            temperature: 0.3, // Lower temperature for consistency
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
        `Answer validation completed. Score: ${result.score}/${result.totalQuestions}, Tokens used: ${tokensUsed}`
      );

      return {
        results: result.results,
        score: result.score,
        totalQuestions: result.totalQuestions,
        percentageScore: result.percentageScore,
        tokens_used: tokensUsed,
      };
    } catch (error: any) {
      logger.error('Gemini answer validation error:', error);
      throw new Error(`Answer validation failed: ${error.message}`);
    }
  }
}

export default GeminiQuizService;
