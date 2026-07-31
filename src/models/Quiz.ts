import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../config/database';
import { Question } from '../types/quiz.types';

export type QuizDifficulty = 'easy' | 'medium' | 'hard';

export interface Quiz {
  id: number;
  video_id: number;
  questions: Question[];
  difficulty: QuizDifficulty;
  tokens_used: number | null;
  model_used: string | null;
  created_at: Date;
}

export interface QuizCreateOptions {
  difficulty?: QuizDifficulty;
  tokensUsed?: number;
  modelUsed?: string;
}

export class QuizModel {
  static async create(
    videoId: number,
    questions: Question[],
    options: QuizCreateOptions = {}
  ): Promise<number> {
    const { difficulty = 'medium', tokensUsed, modelUsed } = options;
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO quizzes (video_id, questions, difficulty, tokens_used, model_used)
       VALUES (?, ?, ?, ?, ?)`,
      [
        videoId,
        JSON.stringify(questions),
        difficulty,
        tokensUsed ?? null,
        modelUsed ?? null,
      ]
    );
    return result.insertId;
  }

  static async findById(id: number): Promise<Quiz | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM quizzes WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return this.parseRow(rows[0]);
  }

  /**
   * Most recent quiz for a video at a given difficulty.
   * Used to serve a cached quiz instead of paying for a Gemini call on every
   * quiz page load.
   */
  static async findLatestByVideo(
    videoId: number,
    difficulty: QuizDifficulty = 'medium'
  ): Promise<Quiz | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM quizzes
       WHERE video_id = ? AND difficulty = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [videoId, difficulty]
    );
    if (rows.length === 0) return null;
    return this.parseRow(rows[0]);
  }

  static async deleteByVideoId(videoId: number): Promise<void> {
    await pool.execute('DELETE FROM quizzes WHERE video_id = ?', [videoId]);
  }

  private static parseRow(row: RowDataPacket): Quiz {
    return {
      ...row,
      questions:
        typeof row.questions === 'string' ? JSON.parse(row.questions) : row.questions,
    } as Quiz;
  }
}

export default QuizModel;
