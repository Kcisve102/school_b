/// <reference path="../types/express-session.d.ts" />
import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { ApiResponse } from '../types';
import logger from '../utils/logger';

export class AuthController {
  static async signup(req: Request, res: Response<ApiResponse>) {
    try {
      const { email, password, full_name } = req.body;

      const user = await AuthService.signup(email, password, full_name);

      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.isAdmin = user.is_admin;

      res.status(201).json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          is_admin: user.is_admin,
        },
        message: 'Account created successfully',
      });
    } catch (error: any) {
      logger.error('Signup error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async login(req: Request, res: Response<ApiResponse>) {
    try {
      const { email, password } = req.body;

      const user = await AuthService.login(email, password);

      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.isAdmin = user.is_admin;

      res.json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          is_admin: user.is_admin,
        },
        message: 'Logged in successfully',
      });
    } catch (error: any) {
      logger.error('Login error:', error);
      res.status(401).json({
        success: false,
        error: error.message,
      });
    }
  }

  static logout(req: Request, res: Response<ApiResponse>): void {
    req.session.destroy((err): void => {
      if (err) {
        logger.error('Logout error:', err);
        res.status(500).json({
          success: false,
          error: 'Failed to logout',
        });
        return;
      }

      res.clearCookie('video_platform_session');
      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    });
  }

  static async getMe(req: Request, res: Response<ApiResponse>) {
    try {
      if (!req.session.userId) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
      }

      const user = await AuthService.getUserById(req.session.userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      return res.json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          is_admin: user.is_admin,
        },
      });
    } catch (error: any) {
      logger.error('Get user error:', error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async checkAuth(req: Request, res: Response<ApiResponse>) {
    res.json({
      success: true,
      data: {
        authenticated: !!req.session.userId,
        isAdmin: req.session.isAdmin || false,
      },
    });
  }
}

export default AuthController;
