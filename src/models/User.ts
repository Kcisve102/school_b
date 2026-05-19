import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../config/database';
import { User } from '../types';

export class UserModel {
  static async create(email: string, password_hash: string, full_name: string): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      'INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)',
      [email, password_hash, full_name]
    );
    return result.insertId;
  }

  static async findByEmail(email: string): Promise<User | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    return rows.length > 0 ? (rows[0] as User) : null;
  }

  static async findById(id: number): Promise<User | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
    return rows.length > 0 ? (rows[0] as User) : null;
  }

  static async updateLastLogin(id: number): Promise<void> {
    await pool.execute(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [id]
    );
  }

  static async findAll(): Promise<User[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id, email, full_name, is_admin, created_at, updated_at, last_login FROM users ORDER BY created_at DESC'
    );
    return rows as User[];
  }

  static async updateRole(id: number, is_admin: boolean): Promise<void> {
    await pool.execute(
      'UPDATE users SET is_admin = ? WHERE id = ?',
      [is_admin, id]
    );
  }

  static async delete(id: number): Promise<void> {
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  }
}

export default UserModel;
