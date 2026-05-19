import { geminiClient, geminiModel } from '../config/gemini';
import { createUserContent, Type } from '@google/genai';
import logger from '../utils/logger';
import { retryGeminiCall } from '../utils/gemini-errors';

export interface GeminiSummaryResponse {
  summary: string;
  key_points: string[];
  tokens_used: number;
}

// JSON Schema for summary output
const summarySchema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'Concise 3-4 sentence summary capturing main topic and key takeaways',
    },
    key_points: {
      type: Type.ARRAY,
      description: 'Array of 5-7 key points as bullet items',
      items: {
        type: Type.STRING,
      },
      minItems: 5,
      maxItems: 7,
    },
  },
  required: ['summary', 'key_points'],
};

export class GeminiSummaryService {
  /**
   * Summarize transcript using Gemini API
   * @param transcript - Full transcript text
   * @returns Summary with key points and token usage
   */
  static async summarize(transcript: string): Promise<GeminiSummaryResponse> {
    try {
      logger.info('Starting Gemini summarization...');

      const prompt = `You are an expert at summarizing educational video content.

Given the following video transcript, please:
1. Provide a concise summary (3-4 sentences) that captures the main topic and key takeaways
2. Extract 5-7 key points as a bulleted list

TRANSCRIPT:
${transcript}

Analyze the content carefully and provide a comprehensive yet concise summary.`;

      const response = await retryGeminiCall(async () => {
        return await geminiClient.models.generateContent({
          model: geminiModel,
          contents: createUserContent([prompt]),
          config: {
            responseMimeType: 'application/json',
            responseSchema: summarySchema,
            temperature: 0.7,
          },
        });
      });

      if (!response.text) {
        throw new Error('No response text received from Gemini');
      }

      const result = JSON.parse(response.text);

      // Get token count from response metadata
      const tokensUsed: number = response.usageMetadata?.totalTokenCount || 0;

      logger.info(`Summarization completed. Tokens used: ${tokensUsed}`);

      return {
        summary: result.summary,
        key_points: result.key_points,
        tokens_used: tokensUsed,
      };
    } catch (error: any) {
      logger.error('Gemini summarization error:', error);
      throw new Error(`Summarization failed: ${error.message}`);
    }
  }
}

export default GeminiSummaryService;
