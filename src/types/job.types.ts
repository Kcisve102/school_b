export interface JobSuggestion {
  title: string;
  keywords: string;
  blurb: string;
}

/*
 * `JobSuggestionWithStatus` was removed along with the availability check.
 * See the note in history.controller.ts: the status could not be determined
 * reliably, and a wrong badge is worse than none.
 */

export interface GeminiJobResponse {
  jobs: JobSuggestion[];
  tokens_used: number;
}
