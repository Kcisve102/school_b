import { RowDataPacket } from 'mysql2';
import pool from '../config/database';
import { encrypt, decrypt } from '../utils/crypto';

export interface FreelancerConnectionRow extends RowDataPacket {
  id: number;
  user_id: number;
  freelancer_user_id: number | null;
  freelancer_username: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  scope: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Safe to return to the client: identity and metadata, never the tokens. */
export interface FreelancerConnectionPublic {
  connected: true;
  freelancerUserId: number | null;
  freelancerUsername: string | null;
  scope: string | null;
  expiresAt: Date | null;
  connectedAt: Date;
}

export interface SaveConnectionData {
  userId: number;
  accessToken: string;
  refreshToken?: string | null;
  scope?: string | null;
  expiresInSeconds?: number | null;
  freelancerUserId?: number | null;
  freelancerUsername?: string | null;
}

export class FreelancerConnection {
  /**
   * Upserts a learner's connection. Re-authorising replaces the stored tokens
   * rather than accumulating rows, so one learner never occupies more than one
   * slot against the app's OAuth user limit.
   */
  static async save(data: SaveConnectionData): Promise<void> {
    const expiresAt = data.expiresInSeconds
      ? new Date(Date.now() + data.expiresInSeconds * 1000)
      : null;

    await pool.execute(
      `INSERT INTO freelancer_connections
         (user_id, freelancer_user_id, freelancer_username,
          access_token_enc, refresh_token_enc, scope, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         freelancer_user_id = VALUES(freelancer_user_id),
         freelancer_username = VALUES(freelancer_username),
         access_token_enc = VALUES(access_token_enc),
         refresh_token_enc = VALUES(refresh_token_enc),
         scope = VALUES(scope),
         expires_at = VALUES(expires_at)`,
      [
        data.userId,
        data.freelancerUserId ?? null,
        data.freelancerUsername ?? null,
        encrypt(data.accessToken),
        data.refreshToken ? encrypt(data.refreshToken) : null,
        data.scope ?? null,
        expiresAt,
      ]
    );
  }

  private static async findRow(userId: number): Promise<FreelancerConnectionRow | null> {
    const [rows] = await pool.execute<FreelancerConnectionRow[]>(
      'SELECT * FROM freelancer_connections WHERE user_id = ? LIMIT 1',
      [userId]
    );
    return rows[0] ?? null;
  }

  /** Decrypted access token, or null when the learner has not connected. */
  static async getAccessToken(userId: number): Promise<string | null> {
    const row = await this.findRow(userId);
    return row ? decrypt(row.access_token_enc) : null;
  }

  static async getRefreshToken(userId: number): Promise<string | null> {
    const row = await this.findRow(userId);
    return row?.refresh_token_enc ? decrypt(row.refresh_token_enc) : null;
  }

  static async getPublic(
    userId: number
  ): Promise<FreelancerConnectionPublic | { connected: false }> {
    const row = await this.findRow(userId);
    if (!row) return { connected: false };

    return {
      connected: true,
      freelancerUserId: row.freelancer_user_id,
      freelancerUsername: row.freelancer_username,
      scope: row.scope,
      expiresAt: row.expires_at,
      connectedAt: row.created_at,
    };
  }

  /**
   * Deletes the row outright. The app has a finite OAuth user limit, so a
   * disconnected learner must return their slot rather than hold it inactive.
   */
  static async disconnect(userId: number): Promise<void> {
    await pool.execute('DELETE FROM freelancer_connections WHERE user_id = ?', [userId]);
  }

  /** Live connection count, for monitoring against the app's user limit. */
  static async countConnections(): Promise<number> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM freelancer_connections'
    );
    return Number(rows[0]?.count ?? 0);
  }
}

export default FreelancerConnection;
