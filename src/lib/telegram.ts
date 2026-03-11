/**
 * Telegram traffic notifications
 * Sends batched updates when paid traffic occurs.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable.
 */

const BATCH_INTERVAL_MS = 60_000; // 1 minute (paid traffic)
const VISIT_BATCH_INTERVAL_MS = 5_000; // 5 seconds (GET visits - faster for browser testing)
const MAX_BATCH_SIZE = 10;

interface TrafficEvent {
  route: string;
  cost: bigint;
  at: number;
}

let botToken: string | null = null;
let chatId: string | null = null;
let buffer: TrafficEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const visitBuffer: string[] = [];
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

export function notifyTraffic(route: string, cost: bigint): void {
  if (!botToken || !chatId) return;

  buffer.push({ route, cost, at: Date.now() });

  if (buffer.length >= MAX_BATCH_SIZE) {
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, BATCH_INTERVAL_MS);
  }
}

export function notifyVisit(path: string): void {
  if (!botToken || !chatId) return;

  visitBuffer.push(path);

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

  const paths = [...visitBuffer];
  visitBuffer.length = 0;

  const counts = paths.reduce((acc, p) => {
    acc[p] = (acc[p] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const summary = Object.entries(counts)
    .map(([p, n]) => `${p} (${n})`)
    .join(', ');
  const msg = `📊 *Visits* (${paths.length} request${paths.length > 1 ? 's' : ''})\n` +
    `📍 ${summary}`;

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
  const msg = `🚀 *Traffic* (${events.length} request${events.length > 1 ? 's' : ''})\n` +
    `💰 ${usdc.toFixed(4)} USDC\n` +
    `📍 ${routes}`;

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
