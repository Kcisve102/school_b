import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../config/database';
import { Transcription, TranscriptSegment } from '../types';

export interface TranscriptionCreateData {
  video_id: number;
  transcript_text: string;
  segments: TranscriptSegment[];
  language?: string;
  confidence_score?: number;
  processing_time?: number;
}

export class TranscriptionModel {
  static async create(data: TranscriptionCreateData): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO transcriptions (video_id, transcript_text, segments, language, confidence_score, processing_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.video_id,
        data.transcript_text,
        JSON.stringify(data.segments),
        data.language || null,
        data.confidence_score || null,
        data.processing_time || null,
      ]
    );
    return result.insertId;
  }

  static async findByVideoId(video_id: number): Promise<Transcription | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM transcriptions WHERE video_id = ?',
      [video_id]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      ...row,
      segments: typeof row.segments === 'string' ? JSON.parse(row.segments) : row.segments,
    } as Transcription;
  }

  static async delete(video_id: number): Promise<void> {
    await pool.execute('DELETE FROM transcriptions WHERE video_id = ?', [video_id]);
  }
}

export default TranscriptionModel;
