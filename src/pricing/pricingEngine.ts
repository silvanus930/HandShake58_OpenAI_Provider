/**
 * Pricing engine with dynamic margins, demand-based pricing,
 * token estimation, and cache-aware profit tracking
 */

import type { ServiceType } from './metrics.js';
import { getRequestsPerMinute } from './metrics.js';

// Modern OpenAI pricing (per token)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': {
    input: 0.000005,
    output: 0.000015,
  },
  'gpt-4o-mini': {
    input: 0.00000015,
    output: 0.0000006,
  },
};

const DEFAULT_MODEL = 'gpt-4o-mini';

// Service-specific margin multipliers
const SERVICE_MARGINS: Record<ServiceType, number> = {
  research: 3.0,
  extract: 4.0,
  document: 3.5,
};

// Fallback token estimates per service (when no prompt provided)
const SERVICE_TOKEN_ESTIMATES: Record<ServiceType, { input: number; output: number }> = {
  research: { input: 1500, output: 700 },
  document: { input: 3000, output: 1200 },
  extract: { input: 1200, output: 500 },
};

const DEBUG_PRICING = process.env.DEBUG_PRICING === 'true';

/**
 * Estimate token count from text (~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Demand-based multiplier - increases price under high load
 */
export function getDemandMultiplier(activeRequests: number): number {
  if (activeRequests > 20) return 1.4;
  if (activeRequests > 10) return 1.2;
  return 1.0;
}

/**
 * Calculate base cost from token counts and model pricing
 */
export function calculateBaseCost(
  inputTokens: number,
  outputTokens: number,
  model: string = DEFAULT_MODEL
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_MODEL];
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

export interface CalculatePriceParams {
  service: ServiceType;
  prompt?: string;
  model?: string;
  activeRequests?: number;
  isCached?: boolean;
}

export interface CalculatePriceResult {
  tokens: number;
  baseCost: number;
  margin: number;
  demand: number;
  finalPrice: number;
}

/**
 * Calculate final price with dynamic margins, demand multiplier, and cache awareness.
 * When isCached=true: OpenAI cost is 0, but margin price is kept (cache profit).
 */
export function calculatePrice({
  service,
  prompt,
  model = DEFAULT_MODEL,
  activeRequests = 0,
  isCached = false,
}: CalculatePriceParams): CalculatePriceResult {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_MODEL];

  let inputTokens: number;
  let outputTokens: number;

  if (prompt !== undefined && prompt !== '') {
    inputTokens = estimateTokens(prompt);
    outputTokens = Math.ceil(inputTokens * 0.5); // assume ~50% output for completion
  } else {
    const estimates = SERVICE_TOKEN_ESTIMATES[service];
    inputTokens = estimates.input;
    outputTokens = estimates.output;
  }

  const tokens = inputTokens + outputTokens;

  // Cache-aware: OpenAI cost = 0 when cached, but we still apply margin for profit
  const baseCost = isCached ? 0 : inputTokens * pricing.input + outputTokens * pricing.output;

  const margin = SERVICE_MARGINS[service] ?? 3;
  const demand = getDemandMultiplier(activeRequests);

  // When cached, finalPrice = margin price (no cost, pure profit)
  const finalPrice = isCached
    ? (inputTokens * pricing.input + outputTokens * pricing.output) * margin * demand
    : baseCost * margin * demand;

  const result: CalculatePriceResult = {
    tokens,
    baseCost: Math.round(baseCost * 1_000_000) / 1_000_000,
    margin,
    demand,
    finalPrice: Math.round(finalPrice * 1_000_000) / 1_000_000,
  };

  if (DEBUG_PRICING) {
    console.log({ service, ...result });
  }

  return result;
}

/**
 * Legacy: Calculate provider price for a service (used by routes, middleware).
 * Uses RPM as demand proxy when activeRequests not provided.
 */
export function calculateProviderPrice(
  serviceType: ServiceType,
  rpm?: number
): { price: number; estimatedCost: number; margin: number } {
  const activeRequests = rpm ?? getRequestsPerMinute(serviceType);
  const result = calculatePrice({
    service: serviceType,
    model: DEFAULT_MODEL,
    activeRequests,
    isCached: false,
  });

  const estimatedCost = calculateBaseCost(
    SERVICE_TOKEN_ESTIMATES[serviceType].input,
    SERVICE_TOKEN_ESTIMATES[serviceType].output,
    DEFAULT_MODEL
  );

  return {
    price: result.finalPrice,
    estimatedCost: Math.round(estimatedCost * 1_000_000) / 1_000_000,
    margin: result.margin,
  };
}

export type ServiceTypeToProvider = {
  research: 'research-agent';
  document: 'document-analyzer';
  extract: 'data-extractor';
};

export const SERVICE_TO_PROVIDER: ServiceTypeToProvider = {
  research: 'research-agent',
  document: 'document-analyzer',
  extract: 'data-extractor',
};
