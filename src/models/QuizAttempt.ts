import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../config/database';
import { QuizAttempt } from '../types';
import { Question, QuizResult } from '../types/quiz.types';
import { JobSuggestion } from '../types/job.types';

export interface QuizAttemptCreateData {
  user_id: number;
  video_id: number;
  questions: Question[];
  results: QuizResult[];
  score: number;
  total_questions: number;
  percentage_score: number;
}

export class QuizAttemptModel {
  static async create(data: QuizAttemptCreateData): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO quiz_attempts (user_id, video_id, questions, results, score, total_questions, percentage_score)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.user_id,
        data.video_id,
        JSON.stringify(data.questions),
        JSON.stringify(data.results),
        data.score,
        data.total_questions,
        data.percentage_score,
      ]
    );
    return result.insertId;
  }

  static async findById(id: number): Promise<QuizAttempt | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM quiz_attempts WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return this.parseRow(rows[0]);
  }

  static async findAllByUser(userId: number): Promise<QuizAttempt[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM quiz_attempts WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows.map((row) => this.parseRow(row));
  }

  static async updateJobSuggestions(id: number, jobSuggestions: JobSuggestion[]): Promise<void> {
    await pool.execute(
      'UPDATE quiz_attempts SET job_suggestions = ? WHERE id = ?',
      [JSON.stringify(jobSuggestions), id]
    );
  }

  static async appendJobSuggestions(id: number, newJobs: JobSuggestion[]): Promise<JobSuggestion[]> {
    const existing = await this.findById(id);
    const combined = [...(existing?.job_suggestions ?? []), ...newJobs];
    await pool.execute(
      'UPDATE quiz_attempts SET job_suggestions = ? WHERE id = ?',
      [JSON.stringify(combined), id]
    );
    return combined;
  }

  private static parseRow(row: RowDataPacket): QuizAttempt {
    return {
      ...row,
      questions: typeof row.questions === 'string' ? JSON.parse(row.questions) : row.questions,
      results: typeof row.results === 'string' ? JSON.parse(row.results) : row.results,
      job_suggestions:
        row.job_suggestions == null
          ? null
          : typeof row.job_suggestions === 'string'
          ? JSON.parse(row.job_suggestions)
          : row.job_suggestions,
    } as QuizAttempt;
  }
}

export default QuizAttemptModel;
