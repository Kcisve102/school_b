import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs/promises';
import { s3Client, s3BucketName, s3VideoPrefix } from '../config/aws';
import logger from '../utils/logger';

export class S3Service {
  static async uploadVideo(
    filePath: string,
    filename: string,
    contentType: string
  ): Promise<{ key: string; url: string }> {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const key = `${s3VideoPrefix}${Date.now()}-${filename}`;

      const command = new PutObjectCommand({
        Bucket: s3BucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
      });

      await s3Client.send(command);

      const url = `https://${s3BucketName}.s3.amazonaws.com/${key}`;

      logger.info(`File uploaded to S3: ${key}`);

      return { key, url };
    } catch (error) {
      logger.error('S3 upload error:', error);
      throw new Error('Failed to upload file to S3');
    }
  }

  static async deleteVideo(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: s3BucketName,
        Key: key,
      });

      await s3Client.send(command);

      logger.info(`File deleted from S3: ${key}`);
    } catch (error) {
      logger.error('S3 delete error:', error);
      throw new Error('Failed to delete file from S3');
    }
  }

  static async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: s3BucketName,
        Key: key,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn });

      return url;
    } catch (error) {
      logger.error('S3 presigned URL error:', error);
      throw new Error('Failed to generate presigned URL');
    }
  }

  static async downloadVideo(key: string, destinationPath: string): Promise<void> {
    try {
      const command = new GetObjectCommand({
        Bucket: s3BucketName,
        Key: key,
      });

      const response = await s3Client.send(command);

      if (!response.Body) {
        throw new Error('No data received from S3');
      }

      // Convert the readable stream to a buffer and write to file
      const chunks: Uint8Array[] = [];
      const stream = response.Body as any;

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      await fs.writeFile(destinationPath, buffer);

      logger.info(`File downloaded from S3 to: ${destinationPath}`);
    } catch (error) {
      logger.error('S3 download error:', error);
      throw new Error('Failed to download file from S3');
    }
  }
}

export default S3Service;
