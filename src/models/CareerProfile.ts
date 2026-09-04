import { RowDataPacket } from 'mysql2';
import pool from '../config/database';
import { CareerProfile } from '../types';
import { HandoffPlatform } from '../types/profile.types';

export interface CareerProfileUpsertData {
  user_id: number;
  headline: string;
  summary: string;
  skills: string[];
  job_titles: string[];
  source_video_id?: number | null;
  source_attempt_id?: number | null;
  generated_language?: string;
  is_edited?: boolean;
}

export class CareerProfileModel {
  static async findByUserId(userId: number): Promise<CareerProfile | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM career_profiles WHERE user_id = ? LIMIT 1',
      [userId]
    );
    if (rows.length === 0) return null;
    return this.parseRow(rows[0]);
  }

  /**
   * Creates or replaces the caller's single profile, and returns the saved row.
   *
   * Returns the row rather than an id on purpose: `INSERT … ON DUPLICATE KEY
   * UPDATE` reports `insertId: 0` when it takes the update path, so the id from
   * the result is only trustworthy on a first insert. Re-reading is the one way
   * to hand back something correct in both cases — and it also picks up the
   * `updated_at` MySQL just set.
   *
   * `source_video_id` / `source_attempt_id` are only overwritten when supplied,
   * so a plain edit-and-save keeps the provenance of the original draft.
   */
  static async upsert(data: CareerProfileUpsertData): Promise<CareerProfile> {
    await pool.execute(
      `INSERT INTO career_profiles
         (user_id, headline, summary, skills, job_titles, source_video_id,
          source_attempt_id, generated_language, is_edited)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         headline = VALUES(headline),
         summary = VALUES(summary),
         skills = VALUES(skills),
         job_titles = VALUES(job_titles),
         source_video_id = COALESCE(VALUES(source_video_id), source_video_id),
         source_attempt_id = COALESCE(VALUES(source_attempt_id), source_attempt_id),
         generated_language = VALUES(generated_language),
         is_edited = VALUES(is_edited)`,
      [
        data.user_id,
        data.headline,
        data.summary,
        JSON.stringify(data.skills),
        JSON.stringify(data.job_titles),
        data.source_video_id ?? null,
        data.source_attempt_id ?? null,
        data.generated_language ?? 'en',
        data.is_edited ?? false,
      ]
    );

    const saved = await this.findByUserId(data.user_id);
    if (!saved) {
      throw new Error('Career profile could not be read back after save');
    }
    return saved;
  }

  /**
   * Records that the learner clicked through to a destination's signup page.
   *
   * This is a click-through, NOT a registration. No job board offers a callback,
   * so we cannot know whether an account was ever created — nothing downstream
   * may present this as "connected".
   */
  static async recordHandoff(userId: number, platform: HandoffPlatform): Promise<void> {
    await pool.execute(
      'UPDATE career_profiles SET last_handoff_platform = ?, last_handoff_at = NOW() WHERE user_id = ?',
      [platform, userId]
    );
  }

  static async deleteByUserId(userId: number): Promise<void> {
    await pool.execute('DELETE FROM career_profiles WHERE user_id = ?', [userId]);
  }

  private static parseRow(row: RowDataPacket): CareerProfile {
    return {
      ...row,
      skills: typeof row.skills === 'string' ? JSON.parse(row.skills) : row.skills,
      job_titles:
        typeof row.job_titles === 'string' ? JSON.parse(row.job_titles) : row.job_titles,
      // MySQL returns BOOLEAN as 0/1; coerce so the JSON matches the declared type.
      is_edited: Boolean(row.is_edited),
    } as CareerProfile;
  }
}

export default CareerProfileModel;
