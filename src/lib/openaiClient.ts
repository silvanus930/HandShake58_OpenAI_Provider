/**
 * OpenAI client helper with retry logic
 * Retries on 429 and network errors, up to 3 times with exponential backoff
 */

import OpenAI from 'openai';

let defaultClient: OpenAI | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { status?: number; code?: string; cause?: unknown };
  if (err.status === 429) return true;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') return true;
  if (err.cause && isRetryable(err.cause)) return true;
  return false;
}

export async function withOpenAIRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isRetryable(e) || attempt === 2) throw e;
      const delay = 1000 * Math.pow(2, attempt);
      console.warn(`[openai] Retry ${attempt + 1}/3 in ${delay}ms:`, e instanceof Error ? e.message : e);
      await sleep(delay);
    }
  }
  throw lastError;
}

export function getOpenAIClient(apiKey?: string): OpenAI {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY environment variable is required');
  if (apiKey) return new OpenAI({ apiKey });
  if (!defaultClient) defaultClient = new OpenAI({ apiKey: key });
  return defaultClient;
}
