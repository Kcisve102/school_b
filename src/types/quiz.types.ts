/**
 * Full question including the answer key. Server-side only — persisted to the
 * `quizzes` table and never sent to the client before submission.
 */
export interface Question {
  id: number;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

/**
 * What the client receives when a quiz is generated: no `correctAnswer`, no
 * `explanation`. Keeping this a distinct type makes leaking the key a
 * compile-time error rather than a silent regression.
 */
export type PublicQuestion = Omit<Question, 'correctAnswer' | 'explanation'>;

export function toPublicQuestion(question: Question): PublicQuestion {
  return {
    id: question.id,
    question: question.question,
    options: question.options,
  };
}

export interface UserAnswer {
  questionId: number;
  selectedOption: number;
}

/**
 * Per-question outcome, returned only after submission.
 * `correctAnswer` is the option *text*, not the index.
 *
 * `selectedOption` is the index the learner picked, or -1 if they skipped the
 * question. It is persisted so the review screen can still show what they chose
 * after they navigate away — attempts recorded before this was added lack the
 * field, hence optional.
 */
export interface QuizResult {
  questionId: number;
  isCorrect: boolean;
  explanation: string;
  correctAnswer: string;
  selectedOption?: number;
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
