import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export const whisperModel = process.env.WHISPER_MODEL || 'whisper-1';
export const gptModel = process.env.GPT_MODEL || 'gpt-4-turbo-preview';

export default openai;
