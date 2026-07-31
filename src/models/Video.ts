import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../config/database';
import { Video } from '../types';

export interface VideoCreateData {
  title: string;
  description?: string;
  uploaded_by: number;
  s3_key: string;
  s3_url: string;
  original_filename?: string;
  file_size?: number;
  duration?: number;
  mime_type?: string;
  upload_type: 'file' | 'link';
  original_url?: string;
  category?: string;
}

export class VideoModel {
  static async create(data: VideoCreateData): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO videos (title, description, uploaded_by, s3_key, s3_url, original_filename,
       file_size, duration, mime_type, upload_type, original_url, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title,
        data.description || null,
        data.uploaded_by,
        data.s3_key,
        data.s3_url,
        data.original_filename || null,
        data.file_size || null,
        data.duration || null,
        data.mime_type || null,
        data.upload_type,
        data.original_url || null,
        data.category || null,
      ]
    );
    return result.insertId;
  }

  static async findById(id: number): Promise<Video | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM videos WHERE id = ?',
      [id]
    );
    return rows.length > 0 ? (rows[0] as Video) : null;
  }

  static async findAll(limit: number = 50, offset: number = 0): Promise<Video[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM videos ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return rows as Video[];
  }

  static async updateStatus(
    id: number,
    field: 'compression_status' | 'transcription_status' | 'summary_status',
    status: 'pending' | 'processing' | 'completed' | 'failed'
  ): Promise<void> {
    await pool.execute(
      `UPDATE videos SET ${field} = ? WHERE id = ?`,
      [status, id]
    );
  }

  /**
   * Processing runs in-process with no queue, so a restart abandons any job
   * that was mid-flight and leaves its row stuck on 'processing' forever.
   * Marking those failed at boot makes them visible and re-renderable.
   *
   * @returns number of rows reconciled
   */
  static async failStaleProcessing(): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE videos
          SET compression_status   = IF(compression_status   = 'processing', 'failed', compression_status),
              transcription_status = IF(transcription_status = 'processing', 'failed', transcription_status),
              summary_status       = IF(summary_status       = 'processing', 'failed', summary_status)
        WHERE compression_status = 'processing'
           OR transcription_status = 'processing'
           OR summary_status = 'processing'`
    );
    return result.affectedRows;
  }

  static async updateDuration(id: number, duration: number): Promise<void> {
    await pool.execute(
      'UPDATE videos SET duration = ? WHERE id = ?',
      [duration, id]
    );
  }

  static async delete(id: number): Promise<void> {
    await pool.execute('DELETE FROM videos WHERE id = ?', [id]);
  }

  static async count(): Promise<number> {
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) as total FROM videos');
    return rows[0].total;
  }

  static async findByCategory(category: string, limit: number = 50, offset: number = 0): Promise<Video[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM videos WHERE category = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [category, limit, offset]
    );
    return rows as Video[];
  }

  static async update(
    id: number,
    data: { title?: string; description?: string; category?: string }
  ): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.title !== undefined) {
      updates.push('title = ?');
      values.push(data.title);
    }

    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }

    if (data.category !== undefined) {
      updates.push('category = ?');
      values.push(data.category);
    }

    if (updates.length === 0) {
      return;
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    await pool.execute(
      `UPDATE videos SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
  }
}

export default VideoModel;
