import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import logger from '../utils/logger';

const execAsync = promisify(exec);

export class YouTubeService {
  /**
   * Check if a URL is a YouTube URL
   */
  static isYouTubeUrl(url: string): boolean {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    return youtubeRegex.test(url);
  }

  /**
   * Check if a URL is a supported video platform (YouTube, Vimeo, etc.)
   */
  static isSupportedPlatform(url: string): boolean {
    const platformRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitter\.com|instagram\.com)\/.+/;
    return platformRegex.test(url);
  }

  /**
   * Download video from YouTube or other supported platforms using yt-dlp
   */
  static async downloadVideo(url: string, outputPath: string): Promise<string> {
    try {
      logger.info(`Downloading video from: ${url}`);

      // yt-dlp command to download the video
      // Add user-agent and extractor args to avoid bot detection
      const command = `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 --extractor-args "youtube:player_client=android" --user-agent "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip" -o "${outputPath}" "${url}"`;

      logger.info(`Executing: ${command}`);

      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      if (stderr && !stderr.includes('Deleting original file')) {
        logger.warn(`yt-dlp stderr: ${stderr}`);
      }

      logger.info(`Video downloaded successfully to: ${outputPath}`);
      logger.debug(`yt-dlp stdout: ${stdout}`);

      return outputPath;
    } catch (error: any) {
      logger.error('YouTube download error:', error);
      throw new Error(`Failed to download video: ${error.message}`);
    }
  }

  /**
   * Get video info without downloading
   */
  static async getVideoInfo(url: string): Promise<any> {
    try {
      const command = `yt-dlp -j "${url}"`;
      const { stdout } = await execAsync(command);
      return JSON.parse(stdout);
    } catch (error: any) {
      logger.error('Failed to get video info:', error);
      throw new Error(`Failed to get video info: ${error.message}`);
    }
  }
}

export default YouTubeService;
