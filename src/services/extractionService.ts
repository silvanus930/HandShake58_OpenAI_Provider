/**
 * Data Extraction Provider Service
 * Hybrid extractor for static and JavaScript-rendered sites
 */

import { getOpenAIClient, withOpenAIRetry } from '../lib/openaiClient.js';
import { getCached, setCached, cacheKey } from '../lib/cache.js';
import { recordRequest, recordCacheHit } from '../pricing/metrics.js';
import { calculateProviderPrice, calculateBaseCost } from '../pricing/pricingEngine.js';
import { hybridExtract } from './hybridExtractor.js';

export interface ExtractionRequest {
  url: string;
}

export interface PricingMetadata {
  provider: string;
  price: number;
  estimated_cost: number;
}

export interface ExtractionResponse {
  type: 'data-extraction';
  url: string;
  extraction_method?: 'static' | 'dynamic';
  extracted_text_length?: number;
  structured_data: Record<string, unknown>;
  pricing?: PricingMetadata;
}

export interface ExtractionErrorResponse {
  type: 'data-extraction';
  url: string;
  error: string;
}

const CACHE_TTL = 3600; // 1h for URL extraction

export async function extractFromUrl(
  url: string,
  apiKey?: string
): Promise<ExtractionResponse | ExtractionErrorResponse> {
  const normalizedUrl = url.replace(/\/$/, '') || url;
  const cacheKeyStr = cacheKey('extract', normalizedUrl);

  const cached = await getCached<Omit<ExtractionResponse, 'pricing'> | ExtractionErrorResponse>(
    cacheKeyStr
  );
  if (cached) {
    recordCacheHit('extract');
    if ('error' in cached && cached.error) {
      return {
        ...cached,
        pricing: undefined,
      } as ExtractionErrorResponse;
    }
    const { price } = calculateProviderPrice('extract');
    return {
      ...cached,
      pricing: { provider: 'extract', price, estimated_cost: 0 },
    } as ExtractionResponse;
  }

  const extracted = await hybridExtract(normalizedUrl);

  if ('error' in extracted && extracted.error) {
    const displayUrl = new URL(normalizedUrl).hostname || normalizedUrl;
    const errorResult: ExtractionErrorResponse = {
      type: 'data-extraction',
      url: displayUrl,
      error: 'content_not_extracted',
    };
    await setCached(cacheKeyStr, errorResult, CACHE_TTL);
    return errorResult;
  }

  const { title, main_text, links, source } = extracted;

  if (!main_text && !title) {
    const displayUrl = new URL(normalizedUrl).hostname || normalizedUrl;
    const errorResult: ExtractionErrorResponse = {
      type: 'data-extraction',
      url: displayUrl,
      error: 'content_not_extracted',
    };
    await setCached(cacheKeyStr, errorResult, CACHE_TTL);
    return errorResult;
  }

  const openai = getOpenAIClient(apiKey);
  const completion = await withOpenAIRetry(() => openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Extract structured data from the webpage text. Return a single JSON object with relevant fields:
- title, description, headings, key_terms, links (array of hrefs), or other salient structure.
Use camelCase keys.`,
      },
      {
        role: 'user',
        content: `URL: ${normalizedUrl}\n\nTitle: ${title}\n\nContent:\n${main_text}`,
      },
    ],
    response_format: { type: 'json_object' },
  }));

  const content = completion.choices[0]?.message?.content || '{}';
  let structured: Record<string, unknown>;
  try {
    structured = JSON.parse(content);
  } catch {
    structured = { rawSummary: content.slice(0, 500) };
  }

  if (!structured.links && links.length > 0) {
    structured.links = links.slice(0, 50);
  }

  const inputTokens = completion.usage?.prompt_tokens ?? 1200;
  const outputTokens = completion.usage?.completion_tokens ?? 500;
  recordRequest('extract', inputTokens, outputTokens);

  const estimatedCost = calculateBaseCost(inputTokens, outputTokens);
  const { price } = calculateProviderPrice('extract');

  const displayUrl = new URL(normalizedUrl).hostname || normalizedUrl;
  const result: ExtractionResponse = {
    type: 'data-extraction',
    url: displayUrl,
    extraction_method: source,
    extracted_text_length: main_text.length,
    structured_data: structured,
    pricing: {
      provider: 'extract',
      price,
      estimated_cost: Math.round(estimatedCost * 1_000_000) / 1_000_000,
    },
  };

  await setCached(
    cacheKeyStr,
    {
      type: result.type,
      url: result.url,
      extraction_method: result.extraction_method,
      extracted_text_length: result.extracted_text_length,
      structured_data: result.structured_data,
    },
    CACHE_TTL
  );
  return result;
}
