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

export interface Summary {
  id: number;
  video_id: number;
  summary_text: string;
  key_points: string[];
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
}
