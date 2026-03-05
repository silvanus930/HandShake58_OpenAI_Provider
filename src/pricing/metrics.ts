/**
 * Simple metrics for pricing engine
 * Tracks requests_per_minute, average_tokens, cache_hits
 */

export type ServiceType = 'research' | 'document' | 'extract';

const requestTimestamps: Map<ServiceType, number[]> = new Map();
const tokenCounts: Map<ServiceType, number[]> = new Map();
const cacheHitCounts: Map<ServiceType, number> = new Map();

const WINDOW_MS = 60_000; // 1 minute

function getRecentTimestamps(service: ServiceType): number[] {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let timestamps = requestTimestamps.get(service) ?? [];
  timestamps = timestamps.filter((t) => t > cutoff);
  requestTimestamps.set(service, timestamps);
  return timestamps;
}

export function recordRequest(service: ServiceType, inputTokens?: number, outputTokens?: number): void {
  const now = Date.now();
  const timestamps = getRecentTimestamps(service);
  timestamps.push(now);
  requestTimestamps.set(service, timestamps);

  if (inputTokens != null && outputTokens != null) {
    const tokens = tokenCounts.get(service) ?? [];
    tokens.push(inputTokens + outputTokens);
    if (tokens.length > 100) tokens.shift();
    tokenCounts.set(service, tokens);
  }
}

export function recordCacheHit(service: ServiceType): void {
  const count = (cacheHitCounts.get(service) ?? 0) + 1;
  cacheHitCounts.set(service, count);
}

export function getRequestsPerMinute(service: ServiceType): number {
  const timestamps = getRecentTimestamps(service);
  return timestamps.length;
}

export function getAverageTokens(service: ServiceType): number {
  const tokens = tokenCounts.get(service) ?? [];
  if (tokens.length === 0) return 0;
  return tokens.reduce((a, b) => a + b, 0) / tokens.length;
}

export function getCacheHits(service: ServiceType): number {
  return cacheHitCounts.get(service) ?? 0;
}

export function getMetrics(service: ServiceType) {
  return {
    requestsPerMinute: getRequestsPerMinute(service),
    averageTokens: getAverageTokens(service),
    cacheHits: getCacheHits(service),
  };
}
