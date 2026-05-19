import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import logger from '../utils/logger';
import { ensureDirectoryExists } from '../utils/helpers';

export interface VideoMetadata {
  duration: number;
  format: string;
  size: number;
}

// Set FFmpeg and FFprobe paths if provided in environment
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
  logger.info(`FFmpeg path set to: ${process.env.FFMPEG_PATH}`);
}

if (process.env.FFPROBE_PATH) {
  ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
  logger.info(`FFprobe path set to: ${process.env.FFPROBE_PATH}`);
}

export class FFmpegService {
  static async getMetadata(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          logger.error('FFprobe error:', err);
          return reject(new Error('Failed to get video metadata'));
        }

        resolve({
          duration: metadata.format.duration || 0,
          format: metadata.format.format_name || 'unknown',
          size: metadata.format.size || 0,
        });
      });
    });
  }

  static async compressVideo(
    inputPath: string,
    outputPath: string,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    await ensureDirectoryExists(path.dirname(outputPath));

    return new Promise((resolve, reject) => {
      const targetBitrate = process.env.FFMPEG_TARGET_BITRATE || '1000k';

      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-preset medium',
          `-b:v ${targetBitrate}`,
          '-c:a aac',
          '-b:a 128k',
          '-movflags +faststart',
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          logger.info(`FFmpeg started: ${commandLine}`);
        })
        .on('progress', (progress) => {
          const percent = progress.percent || 0;
          if (onProgress) {
            onProgress(percent);
          }
          logger.debug(`Compression progress: ${percent.toFixed(2)}%`);
        })
        .on('end', () => {
          logger.info(`Compression completed: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          logger.error('FFmpeg error:', err);
          reject(new Error(`Video compression failed: ${err.message}`));
        })
        .run();
    });
  }

  static async extractAudio(
    videoPath: string,
    audioPath: string
  ): Promise<string> {
    await ensureDirectoryExists(path.dirname(audioPath));

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .output(audioPath)
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .noVideo()
        .on('start', (commandLine) => {
          logger.info(`Audio extraction started: ${commandLine}`);
        })
        .on('end', () => {
          logger.info(`Audio extraction completed: ${audioPath}`);
          resolve(audioPath);
        })
        .on('error', (err) => {
          logger.error('Audio extraction error:', err);
          reject(new Error(`Audio extraction failed: ${err.message}`));
        })
        .run();
    });
  }
}

export default FFmpegService;
