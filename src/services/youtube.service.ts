import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger';

// execFile (not exec) passes arguments directly to the process without a shell,
// so a URL containing shell metacharacters cannot inject a command.
const execFileAsync = promisify(execFile);

/**
 * yt-dlp accepts arguments that begin with `-` as flags, so a crafted URL could
 * otherwise smuggle options into the command even without a shell.
 */
function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported');
  }
}

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
      assertSafeUrl(url);

      logger.info(`Downloading video from: ${url}`);

      const args = [
        '-f',
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format',
        'mp4',
        '--no-check-certificates',
        '--geo-bypass',
        '-o',
        outputPath,
        // `--` ends option parsing so a URL starting with `-` is never read as a flag
        '--',
        url,
      ];

      const { stdout, stderr } = await execFileAsync('yt-dlp', args, {
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
      assertSafeUrl(url);
      const { stdout } = await execFileAsync('yt-dlp', ['-j', '--', url], {
        maxBuffer: 1024 * 1024 * 10,
      });
      return JSON.parse(stdout);
    } catch (error: any) {
      logger.error('Failed to get video info:', error);
      throw new Error(`Failed to get video info: ${error.message}`);
    }
  }
}

export default YouTubeService;
