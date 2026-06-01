import fs from 'fs';
import { geminiClient, geminiModel } from '../config/gemini';
import { createUserContent, createPartFromUri, Type } from '@google/genai';
import logger from '../utils/logger';
import { retryGeminiCall } from '../utils/gemini-errors';

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface GeminiTranscriptionResponse {
  text: string;
  segments: TranscriptSegment[];
  language: string;
}

// JSON Schema for structured output - ensures consistent segment format
const transcriptionSchema = {
  type: Type.OBJECT,
  properties: {
    full_transcript: {
      type: Type.STRING,
      description: 'Complete transcript of the audio',
    },
    language: {
      type: Type.STRING,
      description: 'Detected language code (e.g., en, es, fr)',
    },
    segments: {
      type: Type.ARRAY,
      description: 'Array of transcript segments with timestamps',
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.INTEGER,
            description: 'Sequential segment ID starting from 0',
          },
          start: {
            type: Type.NUMBER,
            description: 'Start time in seconds (decimal format)',
          },
          end: {
            type: Type.NUMBER,
            description: 'End time in seconds (decimal format)',
          },
          text: {
            type: Type.STRING,
            description: 'Transcribed text for this segment',
          },
        },
        required: ['id', 'start', 'end', 'text'],
      },
    },
  },
  required: ['full_transcript', 'language', 'segments'],
};

export class GeminiTranscriptionService {
  /**
   * Transcribe audio file using Gemini API
   * @param audioPath - Path to audio file (mp3, wav, etc.)
   * @returns Transcription with segments and timestamps
   */
  static async transcribe(audioPath: string): Promise<GeminiTranscriptionResponse> {
    try {
      logger.info(`Starting Gemini transcription for: ${audioPath}`);

      // Check if file exists
      if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
      }

      // Determine MIME type from file extension
      const mimeType = this.getMimeType(audioPath);

      // Upload audio file to Gemini Files API
      const uploadedFile = await retryGeminiCall(async () => {
        return await geminiClient.files.upload({
          file: audioPath,
          config: { mimeType },
        });
      });

      if (!uploadedFile.uri || !uploadedFile.name || !uploadedFile.mimeType) {
        throw new Error('Failed to upload file to Gemini: Missing file metadata');
      }

      // Extract values to ensure TypeScript knows they're defined
      const fileUri = uploadedFile.uri;
      const fileName = uploadedFile.name;
      const fileMimeType = uploadedFile.mimeType;

      logger.info(`File uploaded to Gemini: ${fileUri}`);

      // Wait for file processing (Gemini needs time to process large files)
      await this.waitForFileProcessing(fileName);

      // Create transcription prompt with structured output
      const prompt = `You are an expert transcription system. Transcribe this audio file with high accuracy, and output all transcript text in Simplified Chinese (中文简体). If the audio is not in Chinese, translate it into Chinese while preserving meaning.

REQUIREMENTS:
1. Provide the complete transcript as a single text field in Chinese
2. Detect and return the primary language code (ISO 639-1, e.g., 'en', 'es', 'fr') of the source audio
3. Break the transcript into logical segments with precise timestamps
4. Each segment should be 5-15 seconds long for optimal readability
5. Preserve punctuation and formatting
6. If multiple speakers are present, indicate speaker changes in the text (e.g., "说话人1：...")

Return the result in the specified JSON format.`;

      // Generate content with structured output
      const response = await retryGeminiCall(async () => {
        return await geminiClient.models.generateContent({
          model: geminiModel,
          contents: createUserContent([
            createPartFromUri(fileUri, fileMimeType),
            prompt,
          ]),
          config: {
            responseMimeType: 'application/json',
            responseSchema: transcriptionSchema,
          },
        });
      });

      // Parse the structured response
      if (!response.text) {
        throw new Error('No response text received from Gemini');
      }

      const result = JSON.parse(response.text);

      // Delete uploaded file to save quota
      await geminiClient.files.delete({ name: fileName });

      logger.info(
        `Transcription completed. Language: ${result.language}, Segments: ${result.segments.length}`
      );

      return {
        text: result.full_transcript,
        segments: result.segments,
        language: result.language,
      };
    } catch (error: any) {
      logger.error('Gemini transcription error:', error);
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }

  /**
   * Determine MIME type from file extension
   */
  private static getMimeType(filePath: string): string {
    const ext = filePath.toLowerCase().split('.').pop();
    const mimeTypes: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      aiff: 'audio/aiff',
      aac: 'audio/aac',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
      mp4: 'video/mp4',
      mpeg: 'video/mpeg',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      webm: 'video/webm',
    };
    return mimeTypes[ext || ''] || 'audio/mpeg';
  }

  /**
   * Wait for file to be processed by Gemini
   * Files need to be in ACTIVE state before use
   */
  private static async waitForFileProcessing(
    fileName: string,
    maxAttempts: number = 30
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const file = await geminiClient.files.get({ name: fileName });

      if (file.state === 'ACTIVE') {
        logger.info(`File ${fileName} is ready for processing`);
        return;
      }

      if (file.state === 'FAILED') {
        throw new Error(`File processing failed for ${fileName}`);
      }

      logger.debug(`Waiting for file processing... (${i + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
    }

    throw new Error(`File processing timeout for ${fileName}`);
  }
}

export default GeminiTranscriptionService;
