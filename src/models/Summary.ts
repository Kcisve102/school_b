import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../config/database';
import { Summary } from '../types';

export interface SummaryCreateData {
  video_id: number;
  summary_text: string;
  key_points: string[];
  model_used?: string;
  tokens_used?: number;
}

export class SummaryModel {
  static async create(data: SummaryCreateData): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO summaries (video_id, summary_text, key_points, model_used, tokens_used)
       VALUES (?, ?, ?, ?, ?)`,
      [
        data.video_id,
        data.summary_text,
        JSON.stringify(data.key_points),
        data.model_used || null,
        data.tokens_used || null,
      ]
    );
    return result.insertId;
  }

  static async findByVideoId(video_id: number): Promise<Summary | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM summaries WHERE video_id = ?',
      [video_id]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      ...row,
      key_points: typeof row.key_points === 'string' ? JSON.parse(row.key_points) : row.key_points,
    } as Summary;
  }

  static async delete(video_id: number): Promise<void> {
    await pool.execute('DELETE FROM summaries WHERE video_id = ?', [video_id]);
  }
}

export default SummaryModel;
