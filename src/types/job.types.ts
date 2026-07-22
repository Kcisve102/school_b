export interface JobSuggestion {
  title: string;
  keywords: string;
  blurb: string;
}

export interface JobSuggestionWithStatus extends JobSuggestion {
  status: 'active' | 'unavailable';
}

export interface GeminiJobResponse {
  jobs: JobSuggestion[];
  tokens_used: number;
}
