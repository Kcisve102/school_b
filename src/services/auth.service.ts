import bcrypt from 'bcryptjs';
import { UserModel } from '../models/User';
import { User } from '../types';
import logger from '../utils/logger';

const SALT_ROUNDS = 10;

export class AuthService {
  static async signup(email: string, password: string, full_name: string): Promise<User> {
    const existingUser = await UserModel.findByEmail(email);

    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const userId = await UserModel.create(email, password_hash, full_name);

    const user = await UserModel.findById(userId);

    if (!user) {
      throw new Error('Failed to create user');
    }

    logger.info(`New user created: ${email}`);

    return user;
  }

  static async login(email: string, password: string): Promise<User> {
    const user = await UserModel.findByEmail(email);

    if (!user) {
      throw new Error('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    await UserModel.updateLastLogin(user.id);

    logger.info(`User logged in: ${email}`);

    return user;
  }

  static async getUserById(id: number): Promise<User | null> {
    return await UserModel.findById(id);
  }
}

export default AuthService;
