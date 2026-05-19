import path from 'path';
import axios from 'axios';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { VideoModel, VideoCreateData } from '../models/Video';
import { TranscriptionModel } from '../models/Transcription';
import { SummaryModel } from '../models/Summary';
import { S3Service } from './s3.service';
import { FFmpegService } from './ffmpeg.service';
import { GeminiTranscriptionService } from './gemini-transcription.service';
import { GeminiSummaryService } from './gemini-summary.service';
import { YouTubeService } from './youtube.service';
import logger from '../utils/logger';
import { deleteFile, ensureDirectoryExists } from '../utils/helpers';

export class VideoService {
  static async processFileUpload(
    filePath: string,
    originalFilename: string,
    title: string,
    description: string | undefined,
    userId: number,
    mimeType: string,
    category: string | undefined,
    io?: any
  ): Promise<number> {
    const compressedPath = path.join(
      __dirname,
      '../../uploads/compressed',
      `${uuidv4()}.mp4`
    );

    try {
      logger.info(`Processing video upload: ${originalFilename}`);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        throw new Error(`Video file not found at path: ${filePath}`);
      }

      const metadata = await FFmpegService.getMetadata(filePath);

      logger.info(`Compressing video: ${originalFilename}`);

      await FFmpegService.compressVideo(filePath, compressedPath, (percent) => {
        if (io) {
          io.emit('video:compression:progress', { percent });
        }
      });

      logger.info(`Uploading to S3: ${originalFilename}`);
      const { key, url } = await S3Service.uploadVideo(
        compressedPath,
        `${uuidv4()}.mp4`,
        'video/mp4'
      );

      const fileStats = await fs.stat(compressedPath);

      const videoData: VideoCreateData = {
        title,
        description,
        uploaded_by: userId,
        s3_key: key,
        s3_url: url,
        original_filename: originalFilename,
        file_size: fileStats.size,
        duration: Math.floor(metadata.duration),
        mime_type: mimeType,
        upload_type: 'file',
        category,
      };

      const videoId = await VideoModel.create(videoData);
      await VideoModel.updateStatus(videoId, 'compression_status', 'completed');

      await deleteFile(filePath);
      await deleteFile(compressedPath);

      logger.info(`Video uploaded successfully. ID: ${videoId}`);

      this.processTranscriptionAsync(videoId, url, io);

      return videoId;
    } catch (error: any) {
      logger.error('Video processing error:', error);
      await deleteFile(filePath);
      await deleteFile(compressedPath);
      throw new Error(`Video processing failed: ${error.message}`);
    }
  }

  static async processLinkUpload(
    url: string,
    title: string,
    description: string | undefined,
    userId: number,
    category: string | undefined,
    io?: any
  ): Promise<number> {
    const tempDir = path.join(__dirname, '../../uploads/temp');
    const tempPath = path.join(tempDir, `${uuidv4()}.mp4`);

    try {
      // Ensure temp directory exists
      await ensureDirectoryExists(tempDir);

      logger.info(`Downloading video from URL: ${url}`);

      // Use yt-dlp for ALL URLs (supports 1000+ sites including direct video links)
      await YouTubeService.downloadVideo(url, tempPath);

      logger.info('Download completed, processing video...');

      const videoId = await this.processFileUpload(
        tempPath,
        path.basename(url),
        title,
        description,
        userId,
        'video/mp4',
        category,
        io
      );

      return videoId;
    } catch (error: any) {
      logger.error('Link upload error:', error);
      await deleteFile(tempPath);
      throw new Error(`Failed to download video: ${error.message}`);
    }
  }

  private static async processTranscriptionAsync(
    videoId: number,
    _videoUrl: string,
    io?: any
  ): Promise<void> {
    const audioPath = path.join(
      __dirname,
      '../../uploads/temp',
      `${uuidv4()}.mp3`
    );
    const tempVideoPath = path.join(
      __dirname,
      '../../uploads/temp',
      `${uuidv4()}.mp4`
    );

    try {
      logger.info(`Starting transcription for video ID: ${videoId}`);
      await VideoModel.updateStatus(videoId, 'transcription_status', 'processing');

      if (io) {
        io.emit('video:transcription:progress', { videoId, status: 'processing' });
      }

      // Get video record to retrieve S3 key
      const video = await VideoModel.findById(videoId);
      if (!video) {
        throw new Error(`Video not found: ${videoId}`);
      }

      // Download video from S3 to temp location
      logger.info(`Downloading video from S3: ${video.s3_key}`);
      await S3Service.downloadVideo(video.s3_key, tempVideoPath);

      logger.info('Extracting audio from video...');
      await FFmpegService.extractAudio(tempVideoPath, audioPath);

      const transcriptionResult = await GeminiTranscriptionService.transcribe(audioPath);

      await TranscriptionModel.create({
        video_id: videoId,
        transcript_text: transcriptionResult.text,
        segments: transcriptionResult.segments,
        language: transcriptionResult.language,
      });

      await VideoModel.updateStatus(videoId, 'transcription_status', 'completed');

      if (io) {
        io.emit('video:transcription:complete', { videoId });
      }

      logger.info(`Transcription completed for video ID: ${videoId}`);

      await deleteFile(audioPath);
      await deleteFile(tempVideoPath);

      this.processSummarizationAsync(videoId, transcriptionResult.text, io);
    } catch (error: any) {
      logger.error(`Transcription failed for video ID ${videoId}:`, error);
      await VideoModel.updateStatus(videoId, 'transcription_status', 'failed');
      await deleteFile(audioPath);
      await deleteFile(tempVideoPath);

      if (io) {
        io.emit('video:transcription:failed', { videoId, error: error.message });
      }
    }
  }

  private static async processSummarizationAsync(
    videoId: number,
    transcript: string,
    io?: any
  ): Promise<void> {
    try {
      logger.info(`Starting summarization for video ID: ${videoId}`);
      await VideoModel.updateStatus(videoId, 'summary_status', 'processing');

      const summaryResult = await GeminiSummaryService.summarize(transcript);

      await SummaryModel.create({
        video_id: videoId,
        summary_text: summaryResult.summary,
        key_points: summaryResult.key_points,
        model_used: 'gemini-2.5-flash',
        tokens_used: summaryResult.tokens_used,
      });

      await VideoModel.updateStatus(videoId, 'summary_status', 'completed');

      if (io) {
        io.emit('video:summary:complete', { videoId });
      }

      logger.info(`Summarization completed for video ID: ${videoId}`);
    } catch (error: any) {
      logger.error(`Summarization failed for video ID ${videoId}:`, error);
      await VideoModel.updateStatus(videoId, 'summary_status', 'failed');

      if (io) {
        io.emit('video:summary:failed', { videoId, error: error.message });
      }
    }
  }

  static async getVideoById(id: number) {
    return await VideoModel.findById(id);
  }

  static async getAllVideos(limit: number = 50, offset: number = 0) {
    return await VideoModel.findAll(limit, offset);
  }

  static async deleteVideo(id: number): Promise<void> {
    const video = await VideoModel.findById(id);

    if (!video) {
      throw new Error('Video not found');
    }

    await S3Service.deleteVideo(video.s3_key);
    await VideoModel.delete(id);

    logger.info(`Video deleted: ${id}`);
  }
}

export default VideoService;
