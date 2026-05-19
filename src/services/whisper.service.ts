import fs from 'fs';
import { openai, whisperModel } from '../config/openai';
import logger from '../utils/logger';
import { TranscriptSegment } from '../types';

export interface WhisperResponse {
  text: string;
  segments: TranscriptSegment[];
  language: string;
}

export class WhisperService {
  static async transcribe(audioPath: string): Promise<WhisperResponse> {
    try {
      logger.info(`Starting transcription for: ${audioPath}`);

      const audioFile = fs.createReadStream(audioPath);

      const response = await openai.audio.transcriptions.create({
        file: audioFile,
        model: whisperModel,
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      });

      const segments: TranscriptSegment[] = response.segments?.map((seg: any, index: number) => ({
        id: index,
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
      })) || [];

      logger.info(`Transcription completed. Language: ${response.language}, Segments: ${segments.length}`);

      return {
        text: response.text,
        segments,
        language: response.language || 'unknown',
      };
    } catch (error: any) {
      logger.error('Whisper transcription error:', error);
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }
}

export default WhisperService;
