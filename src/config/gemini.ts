import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

export const geminiClient = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY || '',
});

export const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Validate API key on startup
if (!process.env.GOOGLE_API_KEY) {
  logger.warn('WARNING: GOOGLE_API_KEY not set in environment variables');
} else {
  logger.info('Gemini AI client initialized successfully');
}

export default geminiClient;
