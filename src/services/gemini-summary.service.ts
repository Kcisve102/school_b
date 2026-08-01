import { geminiClient, geminiModel } from '../config/gemini';
import { createUserContent, Type } from '@google/genai';
import logger from '../utils/logger';
import { retryGeminiCall } from '../utils/gemini-errors';
import { TranscriptSegment } from '../types';

export interface SummarySection {
  start: number;
  title: string;
}

export interface GeminiSummaryResponse {
  summary: string;
  key_points: string[];
  sections: SummarySection[];
  tokens_used: number;
}

/**
 * Output length has to track input length. A fixed "3-4 sentences" meant a
 * one-hour lecture and a three-minute clip were compressed to the same ~180
 * characters — the hour-long transcript retained barely 1% of its content and
 * degraded into a list of topic names with no actual teaching in it.
 */
interface SummaryTier {
  sentences: string;
  minPoints: number;
  maxPoints: number;
  maxSections: number;
}

function tierFor(transcriptLength: number): SummaryTier {
  if (transcriptLength < 3000) {
    return { sentences: '3-4', minPoints: 5, maxPoints: 7, maxSections: 5 };
  }
  if (transcriptLength < 10000) {
    return { sentences: '5-7', minPoints: 7, maxPoints: 10, maxSections: 8 };
  }
  return { sentences: '8-12', minPoints: 10, maxPoints: 15, maxSections: 12 };
}

/**
 * Built per-request rather than as a module constant: a static schema silently
 * overrides whatever the prompt asks for, so the two must be generated from the
 * same tier or they drift apart.
 */
function buildSummarySchema(tier: SummaryTier) {
  return {
    type: Type.OBJECT,
    properties: {
      summary: {
        type: Type.STRING,
        description: `${tier.sentences} sentence summary capturing what the video actually teaches`,
      },
      key_points: {
        type: Type.ARRAY,
        description: `Array of ${tier.minPoints}-${tier.maxPoints} key points, each stating a concrete fact or technique taught`,
        items: {
          type: Type.STRING,
        },
        minItems: tier.minPoints,
        maxItems: tier.maxPoints,
      },
      sections: {
        type: Type.ARRAY,
        description: `Chapter markers dividing the video into up to ${tier.maxSections} topical sections`,
        items: {
          type: Type.OBJECT,
          properties: {
            start: {
              type: Type.NUMBER,
              description: 'Start time in seconds, taken from the transcript timestamps',
            },
            title: {
              type: Type.STRING,
              description: 'Short label for what this section covers',
            },
          },
          required: ['start', 'title'],
        },
        maxItems: tier.maxSections,
      },
    },
    required: ['summary', 'key_points', 'sections'],
  };
}

/**
 * Segments are rendered as a timestamped outline so the model can anchor
 * chapter markers to real times rather than inventing them. Capped because a
 * long lecture can run to hundreds of segments and the full list adds little
 * over an evenly-spaced sample.
 */
const MAX_OUTLINE_SEGMENTS = 120;

function buildTimestampedOutline(segments: TranscriptSegment[]): string {
  if (!segments || segments.length === 0) return '';

  const step = Math.max(1, Math.ceil(segments.length / MAX_OUTLINE_SEGMENTS));
  const sampled = segments.filter((_, index) => index % step === 0);

  return sampled
    .map((segment) => `[${Math.floor(segment.start)}s] ${segment.text}`)
    .join('\n');
}

export class GeminiSummaryService {
  /**
   * Summarize transcript using Gemini API.
   *
   * @param transcript - Full transcript text
   * @param segments - Timestamped segments, used to anchor chapter markers
   * @returns Summary with key points, sections and token usage
   */
  static async summarize(
    transcript: string,
    segments: TranscriptSegment[] = []
  ): Promise<GeminiSummaryResponse> {
    try {
      const tier = tierFor(transcript.length);
      logger.info(
        `Starting Gemini summarization (${transcript.length} chars, ` +
          `${tier.sentences} sentences, ${tier.minPoints}-${tier.maxPoints} points)...`
      );

      const outline = buildTimestampedOutline(segments);
      const outlineSection = outline
        ? `\n\nTIMESTAMPED TRANSCRIPT (use these times for section markers):\n${outline}`
        : '';

      const prompt = `You are an expert at summarizing educational video content. Write all output in Simplified Chinese (中文简体).

Given the following video transcript:

1. Write a ${tier.sentences} sentence summary in Chinese describing what the video actually teaches — the substance, not a list of topic names.
2. Extract ${tier.minPoints}-${tier.maxPoints} key points in Chinese. Each point must state a concrete fact, technique, or conclusion the viewer learns. Write "元组是不可变的，一旦创建就不能修改" rather than "介绍了元组".
3. Divide the video into up to ${tier.maxSections} topical sections, each with a start time in seconds and a short Chinese title. Take start times from the timestamps provided; the first section should start at or near 0.

Preserve specific names, functions, tools and numbers mentioned in the transcript — those are the details that make a summary useful.

TRANSCRIPT:
${transcript}${outlineSection}`;

      const response = await retryGeminiCall(async () => {
        return await geminiClient.models.generateContent({
          model: geminiModel,
          contents: createUserContent([prompt]),
          config: {
            responseMimeType: 'application/json',
            responseSchema: buildSummarySchema(tier),
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

      logger.info(
        `Summarization completed. Summary: ${result.summary?.length ?? 0} chars, ` +
          `points: ${result.key_points?.length ?? 0}, sections: ${result.sections?.length ?? 0}, ` +
          `tokens: ${tokensUsed}`
      );

      return {
        summary: result.summary,
        key_points: result.key_points,
        sections: normalizeSections(result.sections),
        tokens_used: tokensUsed,
      };
    } catch (error: any) {
      logger.error('Gemini summarization error:', error);
      throw new Error(`Summarization failed: ${error.message}`);
    }
  }
}

/**
 * The model occasionally returns sections out of order or with a negative or
 * duplicated start. Sorting and de-duplicating here keeps the stored data
 * trustworthy enough for the UI to render without defensive checks.
 */
function normalizeSections(sections: unknown): SummarySection[] {
  if (!Array.isArray(sections)) return [];

  const seen = new Set<number>();
  return sections
    .filter(
      (section): section is SummarySection =>
        section != null &&
        typeof section.start === 'number' &&
        Number.isFinite(section.start) &&
        section.start >= 0 &&
        typeof section.title === 'string' &&
        section.title.trim().length > 0
    )
    .map((section) => ({
      start: Math.floor(section.start),
      title: section.title.trim(),
    }))
    .sort((a, b) => a.start - b.start)
    .filter((section) => {
      if (seen.has(section.start)) return false;
      seen.add(section.start);
      return true;
    });
}

export default GeminiSummaryService;
