import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

export const s3Config = {
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
};

export const s3Client = new S3Client(s3Config);

export const s3BucketName = process.env.S3_BUCKET_NAME || 'educational-videos-bucket';
export const s3VideoPrefix = process.env.S3_VIDEO_PREFIX || 'videos/';

export default s3Client;
