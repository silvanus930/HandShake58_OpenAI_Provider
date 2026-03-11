/**
 * Telegram traffic notifications
 * Sends batched updates when paid traffic occurs.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable.
 */

import type { Request } from 'express';

const BATCH_INTERVAL_MS = 60_000; // 1 minute (paid traffic)
const VISIT_BATCH_INTERVAL_MS = 5_000; // 5 seconds (GET visits - faster for browser testing)
const MAX_BATCH_SIZE = 10;

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0];
    return first?.trim() ?? 'unknown';
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp) return (typeof realIp === 'string' ? realIp : realIp[0]) ?? 'unknown';
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

interface TrafficEvent {
  route: string;
  cost: bigint;
  ip: string;
  at: number;
}

interface VisitEvent {
  path: string;
  ip: string;
}

let botToken: string | null = null;
let chatId: string | null = null;
let buffer: TrafficEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const visitBuffer: VisitEvent[] = [];
let visitFlushTimer: ReturnType<typeof setTimeout> | null = null;

export function initTelegram(): void {
  botToken = process.env.TELEGRAM_BOT_TOKEN ?? null;
  chatId = process.env.TELEGRAM_CHAT_ID ?? null;
  if (botToken && chatId) {
    console.log('[telegram] Notifications enabled');
  }
}

export function isEnabled(): boolean {
  return !!(botToken && chatId);
}

export async function notifyStartup(providerName: string, modelsCount: number, port: number, host: string): Promise<void> {
  if (!botToken || !chatId) return;

  const msg = `✅ *${providerName}* started\n` +
    `📦 ${modelsCount} models\n` +
    `🌐 http://${host}:${port}`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'Markdown',
      }),
    });
  } catch (err) {
    console.warn('[telegram] Startup notify failed:', err instanceof Error ? err.message : err);
  }
}

export function notifyTraffic(route: string, cost: bigint, ip: string = 'unknown'): void {
  if (!botToken || !chatId) return;

  buffer.push({ route, cost, ip, at: Date.now() });

  if (buffer.length >= MAX_BATCH_SIZE) {
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, BATCH_INTERVAL_MS);
  }
}

export function notifyVisit(path: string, ip: string = 'unknown'): void {
  if (!botToken || !chatId) return;

  visitBuffer.push({ path, ip });

  if (visitBuffer.length >= MAX_BATCH_SIZE) {
    flushVisits();
  } else if (!visitFlushTimer) {
    visitFlushTimer = setTimeout(flushVisits, VISIT_BATCH_INTERVAL_MS);
  }
}

async function flushVisits(): Promise<void> {
  if (visitFlushTimer) {
    clearTimeout(visitFlushTimer);
    visitFlushTimer = null;
  }
  if (visitBuffer.length === 0) return;

  const events = [...visitBuffer];
  visitBuffer.length = 0;

  const pathCounts = events.reduce((acc, e) => {
    acc[e.path] = (acc[e.path] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const pathSummary = Object.entries(pathCounts)
    .map(([p, n]) => `${p} (${n})`)
    .join(', ');
  const ips = [...new Set(events.map((e) => e.ip))].join(', ');
  const msg = `📊 *Visits* (${events.length} request${events.length > 1 ? 's' : ''})\n` +
    `📍 ${pathSummary}\n` +
    `🖥 ${ips}`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'Markdown',
      }),
    });
  } catch (err) {
    console.warn('[telegram] Visit notify failed:', err instanceof Error ? err.message : err);
  }
}

async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;

  const events = [...buffer];
  buffer = [];

  const totalCost = events.reduce((s, e) => s + e.cost, 0n);
  const usdc = Number(totalCost) / 1_000_000;
  const routes = [...new Set(events.map((e) => e.route))].join(', ');
  const ips = [...new Set(events.map((e) => e.ip))].join(', ');
  const msg = `🚀 *Traffic* (${events.length} request${events.length > 1 ? 's' : ''})\n` +
    `💰 ${usdc.toFixed(4)} USDC\n` +
    `📍 ${routes}\n` +
    `🖥 ${ips}`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'Markdown',
      }),
    });
  } catch (err) {
    console.warn('[telegram] Send failed:', err instanceof Error ? err.message : err);
  }
}
