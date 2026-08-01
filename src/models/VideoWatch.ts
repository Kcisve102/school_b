import { RowDataPacket } from 'mysql2';
import pool from '../config/database';
import { VideoWatch } from '../types';

export class VideoWatchModel {
  /**
   * Records progress through a video.
   *
   * `completed` is sticky: once a learner has finished a video, re-watching the
   * first minute must not demote it back to unfinished. Position, by contrast,
   * always reflects the latest place they were.
   */
  static async upsert(
    userId: number,
    videoId: number,
    positionSeconds: number = 0,
    completed: boolean = false
  ): Promise<void> {
    await pool.execute(
      `INSERT INTO video_watches (user_id, video_id, position_seconds, completed)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         watched_at = NOW(),
         updated_at = NOW(),
         position_seconds = VALUES(position_seconds),
         completed = completed OR VALUES(completed)`,
      [userId, videoId, Math.max(0, Math.floor(positionSeconds)), completed]
    );
  }

  static async findOne(
    userId: number,
    videoId: number
  ): Promise<VideoWatch | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM video_watches WHERE user_id = ? AND video_id = ? LIMIT 1',
      [userId, videoId]
    );
    return (rows[0] as VideoWatch) ?? null;
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
