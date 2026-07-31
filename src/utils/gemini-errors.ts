import logger from './logger';

export class GeminiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export function handleGeminiError(error: any): never {
  // Rate limit errors
  if (error.status === 429 || error.code === 'RESOURCE_EXHAUSTED') {
    logger.error('Gemini API rate limit exceeded');
    throw new GeminiError(
      'API rate limit exceeded. Please try again later.',
      'RATE_LIMIT_EXCEEDED',
      429,
      true
    );
  }

  // Invalid API key
  if (error.status === 401 || error.status === 403) {
    logger.error('Gemini API authentication failed');
    throw new GeminiError(
      'Invalid API key or authentication failed',
      'AUTH_FAILED',
      401,
      false
    );
  }

  // File processing errors
  if (error.message?.includes('File processing failed')) {
    logger.error('Gemini file processing failed:', error);
    throw new GeminiError(
      'File could not be processed by Gemini',
      'FILE_PROCESSING_FAILED',
      500,
      true
    );
  }

  // Quota exceeded
  if (error.code === 'QUOTA_EXCEEDED') {
    logger.error('Gemini API quota exceeded');
    throw new GeminiError(
      'API quota exceeded for today',
      'QUOTA_EXCEEDED',
      429,
      false
    );
  }

  // Generic server errors (5xx)
  if (error.status >= 500) {
    logger.error('Gemini API server error:', error);
    throw new GeminiError(
      'Gemini API service temporarily unavailable',
      'SERVER_ERROR',
      503,
      true
    );
  }

  // Unknown errors
  logger.error('Unknown Gemini API error:', error);
  throw new GeminiError(
    error.message || 'An unexpected error occurred',
    'UNKNOWN_ERROR',
    500,
    false
  );
}

/**
 * Retry wrapper for Gemini API calls with exponential backoff
 */
export async function retryGeminiCall<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      // Classify the raw SDK error into a GeminiError so the `retryable` flag
      // below is meaningful. Without this step nothing was ever an instance of
      // GeminiError, so every failure — including a bad API key — burned all
      // three attempts and their backoff.
      let classified: any = error;
      if (!(error instanceof GeminiError)) {
        try {
          handleGeminiError(error);
        } catch (converted) {
          classified = converted;
        }
      }

      lastError = classified;

      // Don't retry if error is not retryable
      if (classified instanceof GeminiError && !classified.retryable) {
        throw classified;
      }

      if (attempt < maxRetries) {
        const delay = delayMs * Math.pow(2, attempt - 1); // Exponential backoff
        logger.warn(
          `Gemini API call failed (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
