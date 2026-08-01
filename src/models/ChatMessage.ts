import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../config/database';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessageRow {
  id: number;
  user_id: number;
  video_id: number | null;
  role: ChatRole;
  content: string;
  tokens_used: number | null;
  created_at: Date;
}

export interface ChatMessageCreateData {
  user_id: number;
  video_id: number | null;
  role: ChatRole;
  content: string;
  tokens_used?: number;
}

export class ChatMessageModel {
  static async create(data: ChatMessageCreateData): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO chat_messages (user_id, video_id, role, content, tokens_used)
       VALUES (?, ?, ?, ?, ?)`,
      [
        data.user_id,
        data.video_id,
        data.role,
        data.content,
        data.tokens_used ?? null,
      ]
    );
    return result.insertId;
  }

  /**
   * Most recent messages in a thread, oldest-first.
   *
   * `video_id` NULL identifies the global thread, and SQL equality never
   * matches NULL — so the null case needs `IS NULL` rather than `= ?`.
   *
   * The inner query takes the newest `limit` rows and the outer one flips them
   * back into chronological order, so a long conversation keeps its most recent
   * context rather than its opening turns.
   */
  static async findThread(
    userId: number,
    videoId: number | null,
    limit: number
  ): Promise<ChatMessageRow[]> {
    const videoClause = videoId === null ? 'video_id IS NULL' : 'video_id = ?';
    const params: (number | string)[] =
      videoId === null ? [userId, limit] : [userId, videoId, limit];

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM (
         SELECT * FROM chat_messages
          WHERE user_id = ? AND ${videoClause}
          ORDER BY id DESC
          LIMIT ?
       ) AS recent
       ORDER BY recent.id ASC`,
      params
    );

    return rows as ChatMessageRow[];
  }

  static async deleteThread(
    userId: number,
    videoId: number | null
  ): Promise<void> {
    const videoClause = videoId === null ? 'video_id IS NULL' : 'video_id = ?';
    const params = videoId === null ? [userId] : [userId, videoId];

    await pool.execute(
      `DELETE FROM chat_messages WHERE user_id = ? AND ${videoClause}`,
      params
    );
  }
}

export default ChatMessageModel;
