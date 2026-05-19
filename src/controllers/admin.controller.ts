/// <reference path="../types/express-session.d.ts" />
import { Request, Response } from 'express';
import { VideoService } from '../services/video.service';
import { UserModel } from '../models/User';
import { VideoModel } from '../models/Video';
import { ApiResponse } from '../types';
import logger from '../utils/logger';

export class AdminController {
  static async uploadVideo(req: Request, res: Response<ApiResponse>) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded',
        });
      }

      const { title, description } = req.body;
      const userId = req.session.userId!;

      const io = (req.app as any).get('io');

      const videoId = await VideoService.processFileUpload(
        req.file.path,
        req.file.originalname,
        title,
        description,
        userId,
        req.file.mimetype,
        io
      );

      res.status(201).json({
        success: true,
        data: { videoId },
        message: 'Video upload started successfully',
      });
    } catch (error: any) {
      logger.error('Upload video error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async uploadVideoLink(req: Request, res: Response<ApiResponse>) {
    try {
      const { url, title, description } = req.body;
      const userId = req.session.userId!;

      const io = (req.app as any).get('io');

      const videoId = await VideoService.processLinkUpload(
        url,
        title,
        description,
        userId,
        io
      );

      res.status(201).json({
        success: true,
        data: { videoId },
        message: 'Video download and processing started',
      });
    } catch (error: any) {
      logger.error('Upload video link error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async deleteVideo(req: Request, res: Response<ApiResponse>) {
    try {
      const id = parseInt(req.params.id);

      await VideoService.deleteVideo(id);

      res.json({
        success: true,
        message: 'Video deleted successfully',
      });
    } catch (error: any) {
      logger.error('Delete video error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async updateVideo(req: Request, res: Response<ApiResponse>) {
    try {
      const id = parseInt(req.params.id);
      const { title, description } = req.body;

      const video = await VideoModel.findById(id);

      if (!video) {
        return res.status(404).json({
          success: false,
          error: 'Video not found',
        });
      }

      await VideoModel.update(id, { title, description });

      res.json({
        success: true,
        message: 'Video updated successfully',
      });
    } catch (error: any) {
      logger.error('Update video error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async getUsers(req: Request, res: Response<ApiResponse>) {
    try {
      const users = await UserModel.findAll();

      const sanitizedUsers = users.map((user) => ({
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        is_admin: user.is_admin,
        created_at: user.created_at,
        last_login: user.last_login,
      }));

      res.json({
        success: true,
        data: sanitizedUsers,
      });
    } catch (error: any) {
      logger.error('Get users error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async updateUserRole(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = parseInt(req.params.id);
      const { is_admin } = req.body;

      if (userId === req.session.userId) {
        return res.status(400).json({
          success: false,
          error: 'Cannot change your own role',
        });
      }

      await UserModel.updateRole(userId, is_admin);

      res.json({
        success: true,
        message: 'User role updated successfully',
      });
    } catch (error: any) {
      logger.error('Update user role error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async deleteUser(req: Request, res: Response<ApiResponse>) {
    try {
      const userId = parseInt(req.params.id);

      if (userId === req.session.userId) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete your own account',
        });
      }

      await UserModel.delete(userId);

      res.json({
        success: true,
        message: 'User deleted successfully',
      });
    } catch (error: any) {
      logger.error('Delete user error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async getStats(req: Request, res: Response<ApiResponse>) {
    try {
      const videoCount = await VideoModel.count();
      const users = await UserModel.findAll();

      res.json({
        success: true,
        data: {
          totalVideos: videoCount,
          totalUsers: users.length,
          adminUsers: users.filter((u) => u.is_admin).length,
        },
      });
    } catch (error: any) {
      logger.error('Get stats error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

export default AdminController;
