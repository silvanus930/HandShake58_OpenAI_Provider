/**
 * Advanced Pricing Engine
 * 
 * Features:
 * - Dynamic margins
 * - Demand pricing
 * - Token estimation
 * - Cache-aware profit
 * - Real OpenAI token reconciliation
 * - Profit tracking
 */

import type { ServiceType } from './metrics.js';
import { getRequestsPerMinute } from './metrics.js';

/**
 * Minimum request price to avoid micro-losses
 */
const MIN_PRICE = 0.0002;

/**
 * Safety multiplier for estimation errors
 */
const COST_SAFETY_FACTOR = 1.15;

/**
 * Real OpenAI pricing (per token)
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': {
    input: 0.000005,
    output: 0.000015,
  },

  'gpt-4o-mini': {
    input: 0.00000015,
    output: 0.0000006,
  },

  'gpt-4.1': {
    input: 0.000005,
    output: 0.000015,
  },

  'o3': {
    input: 0.000004,
    output: 0.000016,
  },

  'o1': {
    input: 0.000015,
    output: 0.00006,
  }
};

const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Service margin multipliers
 */
const SERVICE_MARGINS: Record<ServiceType, number> = {
  research: 3.0,
  extract: 4.0,
  document: 3.5,
};

/**
 * Token estimates when prompt not provided
 */
const SERVICE_TOKEN_ESTIMATES: Record<ServiceType, { input: number; output: number }> = {
  research: { input: 1500, output: 1200 },
  document: { input: 3000, output: 2000 },
  extract: { input: 1200, output: 800 },
};

const DEBUG_PRICING = process.env.DEBUG_PRICING === 'true';

/**
 * Profit tracking store
 */
const PROFIT_METRICS = {
  totalRevenue: 0,
  totalCost: 0,
  totalProfit: 0,
  requests: 0
};

/**
 * Estimate tokens from text
 */
export function estimateTokens(text: string): number {

  if (!text || text.trim() === '') return 0;

  const words = text.trim().split(/\s+/).length;

  return Math.ceil(words * 1.3);
}

/**
 * Demand surge multiplier
 */
export function getDemandMultiplier(activeRequests: number): number {

  if (activeRequests > 40) return 1.5;

  if (activeRequests > 20) return 1.35;

  if (activeRequests > 10) return 1.15;

  return 1.0;
}

/**
 * Calculate OpenAI base cost
 */
export function calculateBaseCost(
  inputTokens: number,
  outputTokens: number,
  model: string = DEFAULT_MODEL
): number {

  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_MODEL];

  const rawCost =
    inputTokens * pricing.input +
    outputTokens * pricing.output;

  return rawCost * COST_SAFETY_FACTOR;
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
 * Main pricing calculation
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

  if (prompt && prompt !== '') {

    inputTokens = estimateTokens(prompt);

    outputTokens = Math.max(
      500,
      Math.ceil(inputTokens * 1.2)
    );

  } else {

    const estimates = SERVICE_TOKEN_ESTIMATES[service];

    inputTokens = estimates.input;
    outputTokens = estimates.output;
  }

  const tokens = inputTokens + outputTokens;

  const rawCost =
    inputTokens * pricing.input +
    outputTokens * pricing.output;

  const baseCost = isCached ? 0 : rawCost * COST_SAFETY_FACTOR;

  const margin = SERVICE_MARGINS[service] ?? 3;

  const demand = getDemandMultiplier(activeRequests);

  const calculatedPrice = isCached
    ? rawCost * margin * demand
    : baseCost * margin * demand;

  const finalPrice = Math.max(MIN_PRICE, calculatedPrice);

  const result: CalculatePriceResult = {

    tokens,

    baseCost: Math.round(baseCost * 1_000_000) / 1_000_000,

    margin,

    demand,

    finalPrice: Math.round(finalPrice * 1_000_000) / 1_000_000,
  };

  if (DEBUG_PRICING) {

    console.log({
      service,
      model,
      tokens: result.tokens,
      baseCost: result.baseCost,
      margin: result.margin,
      demand: result.demand,
      finalPrice: result.finalPrice
    });
  }

  return result;
}

/**
 * Reconcile real OpenAI usage after response
 */
export function reconcileUsage(
  chargedPrice: number,
  model: string,
  promptTokens: number,
  completionTokens: number
) {

  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_MODEL];

  const realCost =
    promptTokens * pricing.input +
    completionTokens * pricing.output;

  const profit = chargedPrice - realCost;

  PROFIT_METRICS.totalRevenue += chargedPrice;
  PROFIT_METRICS.totalCost += realCost;
  PROFIT_METRICS.totalProfit += profit;
  PROFIT_METRICS.requests += 1;

  if (DEBUG_PRICING) {

    console.log({
      realCost,
      chargedPrice,
      profit,
      profitMargin: ((profit / chargedPrice) * 100).toFixed(2) + "%"
    });
  }

  return {
    realCost,
    profit
  };
}

/**
 * Get profit statistics
 */
export function getProfitMetrics() {

  return {

    revenue: PROFIT_METRICS.totalRevenue,

    cost: PROFIT_METRICS.totalCost,

    profit: PROFIT_METRICS.totalProfit,

    requests: PROFIT_METRICS.requests,

    avgProfitPerRequest:
      PROFIT_METRICS.requests > 0
        ? PROFIT_METRICS.totalProfit / PROFIT_METRICS.requests
        : 0
  };
}

/**
 * Legacy provider pricing
 */
export function calculateProviderPrice(
  serviceType: ServiceType,
  rpm?: number
): { price: number; estimatedCost: number; margin: number } {

  const activeRequests =
    rpm ?? getRequestsPerMinute(serviceType);

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

/**
 * Service → Provider mapping
 */
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