import { Request, Response } from 'express';
import { VideoService } from '../services/video.service';
import { TranscriptionModel } from '../models/Transcription';
import { SummaryModel } from '../models/Summary';
import { ApiResponse } from '../types';
import logger from '../utils/logger';

export class VideoController {
  static async getAll(req: Request, res: Response<ApiResponse>) {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const videos = await VideoService.getAllVideos(limit, offset);

      res.json({
        success: true,
        data: videos,
      });
    } catch (error: any) {
      logger.error('Get videos error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async getById(req: Request, res: Response<ApiResponse>) {
    try {
      const id = parseInt(req.params.id);

      const video = await VideoService.getVideoById(id);

      if (!video) {
        return res.status(404).json({
          success: false,
          error: 'Video not found',
        });
      }

      res.json({
        success: true,
        data: video,
      });
    } catch (error: any) {
      logger.error('Get video error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async getTranscript(req: Request, res: Response<ApiResponse>) {
    try {
      const videoId = parseInt(req.params.id);

      const transcription = await TranscriptionModel.findByVideoId(videoId);

      if (!transcription) {
        return res.status(404).json({
          success: false,
          error: 'Transcription not found',
        });
      }

      res.json({
        success: true,
        data: transcription,
      });
    } catch (error: any) {
      logger.error('Get transcript error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async getSummary(req: Request, res: Response<ApiResponse>) {
    try {
      const videoId = parseInt(req.params.id);

      const summary = await SummaryModel.findByVideoId(videoId);

      if (!summary) {
        return res.status(404).json({
          success: false,
          error: 'Summary not found',
        });
      }

      res.json({
        success: true,
        data: summary,
      });
    } catch (error: any) {
      logger.error('Get summary error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

export default VideoController;
