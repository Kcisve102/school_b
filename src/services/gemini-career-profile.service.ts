import { geminiClient, geminiModel } from '../config/gemini';
import { createUserContent, Type } from '@google/genai';
import logger from '../utils/logger';
import { retryGeminiCall } from '../utils/gemini-errors';
import { GeminiCareerProfileResponse } from '../types/profile.types';

const careerProfileSchema = {
  type: Type.OBJECT,
  properties: {
    headline: {
      type: Type.STRING,
      description:
        'A short professional headline, at most 120 characters, describing the learner as an entry-level candidate in this field',
    },
    summary: {
      type: Type.STRING,
      description:
        'A 3-5 sentence professional summary written in the first person, suitable for pasting into a job board profile',
    },
    skills: {
      type: Type.ARRAY,
      description: 'Between 6 and 10 concrete, searchable skill keywords',
      items: { type: Type.STRING },
      minItems: 6,
      maxItems: 10,
    },
    job_titles: {
      type: Type.ARRAY,
      description: 'Between 3 and 5 realistic entry-level job titles to search for',
      items: { type: Type.STRING },
      minItems: 3,
      maxItems: 5,
    },
  },
  required: ['headline', 'summary', 'skills', 'job_titles'],
};

export class GeminiCareerProfileService {
  /**
   * Draft a career profile from one watched video and one passed quiz.
   *
   * Written in English regardless of UI language: all four destinations are
   * US job boards whose search and ATS matching are English-token based, so a
   * localized profile would not be a usable artifact once pasted. This follows
   * the same reasoning as GeminiJobService. UI chrome stays localized.
   */
  static async generateProfileDraft(
    fullName: string,
    summary: string,
    keyPoints: string[],
    category: string | null,
    percentageScore: number
  ): Promise<GeminiCareerProfileResponse> {
    try {
      logger.info('Starting Gemini career profile draft generation...');

      const prompt = `You are helping a learner write an honest professional profile they can paste into a job board such as Indeed, ZipRecruiter, Glassdoor or Dice.

LEARNER NAME: ${fullName}

WHAT THEY JUST COMPLETED — video summary:
${summary}

KEY POINTS FROM THE VIDEO:
${keyPoints.map((point, idx) => `${idx + 1}. ${point}`).join('\n')}

CATEGORY: ${category || 'General'}

QUIZ RESULT: they scored ${percentageScore}% on a quiz covering this material.

CRITICAL HONESTY CONSTRAINTS — these matter more than polish:

1. DO NOT OVERCLAIM. The only thing you know is that this learner watched ONE
   educational video and passed ONE quiz on it. Describe them with phrasing like
   "familiar with", "recently trained in", "completed coursework covering",
   "foundational understanding of". NEVER write "5 years of experience",
   "seasoned", "expert", "extensive background" or any claim of professional
   history. This profile will be pasted onto a real job board under this
   person's real name — a fabricated work history is far worse for them than a
   modest profile.

2. DO NOT INVENT FACTS. No employers, no company names, no job titles they have
   held, no dates, no degrees, no certifications, no schools, no locations, no
   languages spoken, no portfolio links. You have none of that information, and
   guessing it puts false statements in their name.

Produce:
1. headline - a short professional headline (max 120 characters) positioning them as an entry-level or newly-trained candidate.
2. summary - 3-5 sentences in the first person ("I have recently trained in..."), honest about being early in this field while making the relevant knowledge clear.
3. skills - 6-10 concrete, searchable skill keywords drawn from the material above. Single terms or short phrases, the kind a recruiter filters on.
4. job_titles - 3-5 realistic ENTRY-LEVEL job titles this person could reasonably search for now.

Write the response in English.`;

      const response = await retryGeminiCall(async () => {
        return await geminiClient.models.generateContent({
          model: geminiModel,
          contents: createUserContent([prompt]),
          config: {
            responseMimeType: 'application/json',
            responseSchema: careerProfileSchema,
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
        `Career profile draft generated. Skills: ${result.skills.length}, Titles: ${result.job_titles.length}, Tokens: ${tokensUsed}`
      );

      return {
        headline: result.headline,
        summary: result.summary,
        skills: result.skills,
        job_titles: result.job_titles,
        tokens_used: tokensUsed,
      };
    } catch (error: any) {
      logger.error('Gemini career profile error:', error);
      throw new Error(`Career profile generation failed: ${error.message}`);
    }
  }
}

export default GeminiCareerProfileService;
