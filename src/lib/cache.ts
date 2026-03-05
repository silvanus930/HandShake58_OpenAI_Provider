/**
 * Optional Redis caching layer to reduce repeated OpenAI calls
 */

import Redis from 'ioredis';

let redis: Redis | null = null;
const CACHE_TTL = 3600; // 1 hour default

export async function getCacheClient(): Promise<Redis | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!redis) {
    try {
      redis = new Redis(url);
      redis.on('error', (err) => console.warn('[cache] Redis error:', err.message));
    } catch (err) {
      console.warn('[cache] Redis connect failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }
  return redis;
}

export async function getCached<T>(key: string): Promise<T | null> {
  const client = await getCacheClient();
  if (!client) return null;
  try {
    const raw = await client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setCached(key: string, value: unknown, ttlSeconds = CACHE_TTL): Promise<void> {
  const client = await getCacheClient();
  if (!client) return;
  try {
    await client.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // ignore cache write errors
  }
}

export function cacheKey(prefix: string, ...parts: string[]): string {
  const safe = parts.map((p) => p.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 200));
  return `hs58:${prefix}:${safe.join(':')}`;
}
