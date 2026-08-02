import { Question, QuizResult } from './quiz.types';
import { JobSuggestion } from './job.types';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  is_admin: boolean;
  created_at: Date;
  updated_at: Date;
  last_login: Date | null;
}

export interface Video {
  id: number;
  title: string;
  description: string | null;
  uploaded_by: number;
  s3_key: string;
  s3_url: string;
  original_filename: string | null;
  file_size: number | null;
  duration: number | null;
  mime_type: string | null;
  upload_type: 'file' | 'link';
  original_url: string | null;
  category: string | null;
  compression_status: 'pending' | 'processing' | 'completed' | 'failed';
  transcription_status: 'pending' | 'processing' | 'completed' | 'failed';
  summary_status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: Date;
  updated_at: Date;
}

export interface Transcription {
  id: number;
  video_id: number;
  transcript_text: string;
  segments: TranscriptSegment[];
  language: string | null;
  confidence_score: number | null;
  processing_time: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

/** A chapter marker: where a topic starts, in seconds. */
export interface SummarySection {
  start: number;
  title: string;
}

export interface Summary {
  id: number;
  video_id: number;
  summary_text: string;
  key_points: string[];
  /** Null for summaries generated before chapter markers were added. */
  sections: SummarySection[] | null;
  model_used: string | null;
  tokens_used: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  total?: number;
}

export interface VideoWatch {
  id: number;
  user_id: number;
  video_id: number;
  position_seconds: number;
  completed: boolean;
  watched_at: Date;
  updated_at: Date;
}

export interface QuizAttempt {
  id: number;
  user_id: number;
  video_id: number;
  quiz_id: number | null;
  questions: Question[];
  results: QuizResult[];
  score: number;
  total_questions: number;
  percentage_score: number;
  job_suggestions: JobSuggestion[] | null;
  created_at: Date;
}

export interface QuizAttemptDetail {
  id: number;
  videoId: number;
  questions: Question[];
  results: QuizResult[];
  score: number;
  totalQuestions: number;
  percentageScore: number;
  jobSuggestions: JobSuggestion[] | null;
  createdAt: Date;
}
