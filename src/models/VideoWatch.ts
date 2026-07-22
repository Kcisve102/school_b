import { RowDataPacket } from 'mysql2';
import pool from '../config/database';
import { VideoWatch } from '../types';

export class VideoWatchModel {
  static async upsert(userId: number, videoId: number): Promise<void> {
    await pool.execute(
      `INSERT INTO video_watches (user_id, video_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE watched_at = NOW(), updated_at = NOW()`,
      [userId, videoId]
    );
  }

  static async findAllByUser(userId: number): Promise<VideoWatch[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM video_watches WHERE user_id = ? ORDER BY watched_at DESC',
      [userId]
    );
    return rows as VideoWatch[];
  }
}

export default VideoWatchModel;
