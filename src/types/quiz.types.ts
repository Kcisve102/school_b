export interface Question {
  id: number;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

export interface UserAnswer {
  questionId: number;
  selectedOption: number;
}

export interface QuizResult {
  questionId: number;
  isCorrect: boolean;
  explanation: string;
  correctAnswer: string;
}

export interface ValidationResponse {
  results: QuizResult[];
  score: number;
  totalQuestions: number;
  percentageScore: number;
}

export interface GeminiQuizResponse {
  questions: Question[];
  tokens_used: number;
}

export interface GeminiValidationResponse extends ValidationResponse {
  tokens_used: number;
}
