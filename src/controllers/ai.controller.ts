import { Request, Response } from 'express';
import { VideoModel } from '../models/Video';
import { ApiResponse } from '../types';
import logger from '../utils/logger';

export class AIController {
  static async getStatus(req: Request, res: Response<ApiResponse>) {
    try {
      const videoId = parseInt(req.params.videoId);

      const video = await VideoModel.findById(videoId);

      if (!video) {
        return res.status(404).json({
          success: false,
          error: 'Video not found',
        });
      }

      res.json({
        success: true,
        data: {
          compression_status: video.compression_status,
          transcription_status: video.transcription_status,
          summary_status: video.summary_status,
        },
      });
    } catch (error: any) {
      logger.error('Get AI status error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

export default AIController;
