/**
 * Research Provider Service
 * Fetches web results, sends to OpenAI, returns structured research
 */

import axios from 'axios';
import { getOpenAIClient, withOpenAIRetry } from '../lib/openaiClient.js';
import { getCached, setCached, cacheKey } from '../lib/cache.js';
import { recordRequest, recordCacheHit } from '../pricing/metrics.js';
import { calculateProviderPrice, calculateBaseCost } from '../pricing/pricingEngine.js';

export interface ResearchRequest {
  query: string;
}

export interface PricingMetadata {
  provider: string;
  price: number;
  estimated_cost: number;
}

export interface ResearchResponse {
  type: 'research';
  query: string;
  summary: string;
  key_points: string[];
  sources: string[];
  pricing?: PricingMetadata;
}

const CACHE_TTL = 1800; // 30 min for research

export async function runResearch(query: string, apiKey?: string): Promise<ResearchResponse> {
  const cacheKeyStr = cacheKey('research', query.toLowerCase().trim());
  const cached = await getCached<Omit<ResearchResponse, 'pricing'>>(cacheKeyStr);
  if (cached) {
    recordCacheHit('research');
    const { price } = calculateProviderPrice('research');
    return {
      ...cached,
      pricing: { provider: 'research', price, estimated_cost: 0 },
    };
  }

  let webContext = '';
  try {
    // Optional: fetch search results (DuckDuckGo HTML for simplicity, no API key)
    const searchRes = await axios.get<string>(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HS58-Research/1.0)' }, timeout: 5000 }
    );
    const text = (searchRes.data || '').slice(0, 8000);
    if (text) webContext = `Web search excerpt:\n${text}`;
  } catch {
    // Continue without web context
  }

  const openai = getOpenAIClient(apiKey);
  const systemPrompt = `You are a research assistant. Summarize the query and provide key points. 
Return a JSON object with: summary (string), key_points (string array), sources (string array of any URLs or references mentioned).
Keep sources minimal if none provided.`;
  const userContent = webContext
    ? `Query: "${query}"\n\n${webContext}\n\nSummarize and extract key points.`
    : `Query: "${query}"\n\nProvide a summary and key points.`;

  const completion = await withOpenAIRetry(() => openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
  }));

  const content = completion.choices[0]?.message?.content || '{}';
  let parsed: { summary?: string; key_points?: string[]; sources?: string[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { summary: content, key_points: [], sources: [] };
  }

  const inputTokens = completion.usage?.prompt_tokens ?? 1500;
  const outputTokens = completion.usage?.completion_tokens ?? 700;
  recordRequest('research', inputTokens, outputTokens);

  const estimatedCost = calculateBaseCost(inputTokens, outputTokens);
  const { price } = calculateProviderPrice('research');

  const result: ResearchResponse = {
    type: 'research',
    query,
    summary: parsed.summary || '',
    key_points: Array.isArray(parsed.key_points) ? parsed.key_points : [],
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    pricing: {
      provider: 'research',
      price,
      estimated_cost: Math.round(estimatedCost * 1_000_000) / 1_000_000,
    },
  };

  await setCached(cacheKeyStr, { ...result, pricing: undefined }, CACHE_TTL);
  return result;
}
