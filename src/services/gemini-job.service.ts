import { geminiClient, geminiModel } from '../config/gemini';
import { createUserContent, Type } from '@google/genai';
import logger from '../utils/logger';
import { retryGeminiCall } from '../utils/gemini-errors';
import { GeminiJobResponse } from '../types/job.types';

const jobSuggestionSchema = {
  type: Type.OBJECT,
  properties: {
    jobs: {
      type: Type.ARRAY,
      description: 'Array of exactly 5 job suggestions',
      items: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: 'Realistic job title',
          },
          keywords: {
            type: Type.STRING,
            description: 'Concise search keywords (job title + core skill) suitable for a job board search box. Do not include the word "remote" — the search URL applies that filter itself',
          },
          blurb: {
            type: Type.STRING,
            description: 'One or two sentence description of the role and why it fits what was just learned',
          },
        },
        required: ['title', 'keywords', 'blurb'],
      },
      minItems: 5,
      maxItems: 5,
    },
  },
  required: ['jobs'],
};

export class GeminiJobService {
  /**
   * Generate 5 job suggestions based on video summary/key points.
   * Kept in English regardless of quiz/chat language, since keywords feed
   * directly into Indeed and Fiverr search URLs.
   *
   * Constrained to remote work: these learners generally cannot relocate or
   * commute, so an on-site role is not an opportunity for them. The remote
   * filter is applied twice over — here, so the suggested roles themselves are
   * remote-capable, and again in the Indeed URL, which filters listings.
   */
  static async generateJobSuggestions(
    summary: string,
    keyPoints: string[],
    category: string | null,
    existingTitles: string[] = []
  ): Promise<GeminiJobResponse> {
    try {
      logger.info('Starting Gemini job suggestion generation...');

      const exclusionClause =
        existingTitles.length > 0
          ? `\n\nDo not repeat any of these already-suggested job titles: ${existingTitles.join(', ')}. Suggest 5 NEW, distinct roles.`
          : '';

      const prompt = `You are a career advisor helping learners discover relevant job opportunities based on educational video content they just completed and passed a quiz on.

VIDEO SUMMARY:
${summary}

KEY POINTS:
${keyPoints.map((point, idx) => `${idx + 1}. ${point}`).join('\n')}

CATEGORY: ${category || 'General'}

Suggest EXACTLY 5 real-world job titles that someone who has learned this content could pursue or that are closely related to these skills.

IMPORTANT: every suggestion must be work that can be done REMOTELY, from home, over the internet. These learners often cannot relocate or commute, so a role requiring physical presence is useless to them. Never suggest a job that needs on-site attendance. If the video content is inherently hands-on, suggest the remote or online-delivered roles it still opens up — teaching, tutoring, consulting, content creation, support or quality review in that field.${exclusionClause}

For each job provide:
1. title - a realistic job title
2. keywords - 2-4 concise search keywords (job title + core skill) suitable for pasting into a job board search box. Do NOT put the word "remote" in the keywords; the search link applies a remote filter of its own, and duplicating it there only narrows the text match
3. blurb - 1-2 sentences on why this role connects to what they learned

Write the response in English.`;

      const response = await retryGeminiCall(async () => {
        return await geminiClient.models.generateContent({
          model: geminiModel,
          contents: createUserContent([prompt]),
          config: {
            responseMimeType: 'application/json',
            responseSchema: jobSuggestionSchema,
            temperature: 0.7,
          },
        });
      });

      if (!response.text) {
        throw new Error('No response text received from Gemini');
      }

      const result = JSON.parse(response.text);
      const tokensUsed: number = response.usageMetadata?.totalTokenCount || 0;

      logger.info(
        `Job suggestions generated. Jobs: ${result.jobs.length}, Tokens: ${tokensUsed}`
      );

      return {
        jobs: result.jobs,
        tokens_used: tokensUsed,
      };
    } catch (error: any) {
      logger.error('Gemini job suggestion error:', error);
      throw new Error(`Job suggestion generation failed: ${error.message}`);
    }
  }
}

export default GeminiJobService;
