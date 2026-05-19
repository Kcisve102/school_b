import { openai, gptModel } from '../config/openai';
import logger from '../utils/logger';

export interface SummaryResponse {
  summary: string;
  key_points: string[];
  tokens_used: number;
}

export class GPTService {
  static async summarize(transcript: string): Promise<SummaryResponse> {
    try {
      logger.info('Starting GPT summarization...');

      const prompt = `You are an expert at summarizing educational video content.

Given the following video transcript, please:
1. Provide a concise summary (3-4 sentences) that captures the main topic and key takeaways
2. Extract 5-7 key points as a bulleted list

Format your response as JSON with this structure:
{
  "summary": "your summary here",
  "key_points": ["point 1", "point 2", ...]
}

Transcript:
${transcript}`;

      const response = await openai.chat.completions.create({
        model: gptModel,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that summarizes educational videos. Always respond with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from GPT');
      }

      const result = JSON.parse(content);
      const tokens_used = response.usage?.total_tokens || 0;

      logger.info(`Summarization completed. Tokens used: ${tokens_used}`);

      return {
        summary: result.summary,
        key_points: result.key_points,
        tokens_used,
      };
    } catch (error: any) {
      logger.error('GPT summarization error:', error);
      throw new Error(`Summarization failed: ${error.message}`);
    }
  }
}

export default GPTService;
