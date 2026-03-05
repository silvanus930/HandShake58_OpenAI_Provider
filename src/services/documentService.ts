/**
 * Document Analysis Provider Service
 * Parses PDF, extracts text, sends to OpenAI for summary and insights
 */

// @ts-expect-error - pdf-parse has no types
import pdf from 'pdf-parse';
import { getOpenAIClient, withOpenAIRetry } from '../lib/openaiClient.js';
import { getCached, setCached, cacheKey } from '../lib/cache.js';
import { recordRequest, recordCacheHit } from '../pricing/metrics.js';
import { calculateProviderPrice, calculateBaseCost } from '../pricing/pricingEngine.js';

export interface PricingMetadata {
  provider: string;
  price: number;
  estimated_cost: number;
}

export interface DocumentResponse {
  type: 'document-analysis';
  summary: string;
  entities: string[];
  important_points: string[];
  pricing?: PricingMetadata;
}

const CACHE_TTL = 86400; // 24h for doc analysis (content-based key)

export async function analyzeDocument(
  buffer: Buffer,
  apiKey?: string,
  contentHash?: string
): Promise<DocumentResponse> {
  const key = contentHash || cacheKey('doc', buffer.slice(0, 64).toString('hex'));
  const cacheKeyStr = cacheKey('document', key);
  const cached = await getCached<Omit<DocumentResponse, 'pricing'>>(cacheKeyStr);
  if (cached) {
    recordCacheHit('document');
    const { price } = calculateProviderPrice('document');
    return {
      ...cached,
      pricing: { provider: 'document', price, estimated_cost: 0 },
    };
  }

  const data = await pdf(buffer);
  const text = (data?.text || '').trim().slice(0, 120000); // ~30k tokens max

  if (!text) {
    throw new Error('No text could be extracted from the PDF');
  }

  const openai = getOpenAIClient(apiKey);
  const completion = await withOpenAIRetry(() => openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a document analyst. Extract:
1. A concise summary
2. Named entities (people, organizations, dates, etc.)
3. Important points
Return JSON: { summary, entities: string[], important_points: string[] }`,
      },
      { role: 'user', content: `Analyze this document:\n\n${text}` },
    ],
    response_format: { type: 'json_object' },
  }));

  const content = completion.choices[0]?.message?.content || '{}';
  let parsed: { summary?: string; entities?: string[]; important_points?: string[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {
      summary: content.slice(0, 500),
      entities: [],
      important_points: [],
    };
  }

  const inputTokens = completion.usage?.prompt_tokens ?? 3000;
  const outputTokens = completion.usage?.completion_tokens ?? 1200;
  recordRequest('document', inputTokens, outputTokens);

  const estimatedCost = calculateBaseCost(inputTokens, outputTokens);
  const { price } = calculateProviderPrice('document');

  const result: DocumentResponse = {
    type: 'document-analysis',
    summary: parsed.summary || '',
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    important_points: Array.isArray(parsed.important_points) ? parsed.important_points : [],
    pricing: {
      provider: 'document',
      price,
      estimated_cost: Math.round(estimatedCost * 1_000_000) / 1_000_000,
    },
  };

  await setCached(cacheKeyStr, { ...result, pricing: undefined }, CACHE_TTL);
  return result;
}
