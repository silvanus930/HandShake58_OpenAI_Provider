/**
 * Token guard middleware - protects OpenAI API from abuse
 * Runs BEFORE voucher validation and OpenAI calls
 */

import type { Request, Response, NextFunction } from 'express';
import type { ProviderConfig } from '../types.js';
import { calculatePrice } from '../pricing/pricingEngine.js';

function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

function blockRequest(res: Response, reason: string, ip?: string): void {
  console.warn('tokenGuard blocked request', { ip: ip || 'unknown', reason });
}

export type TokenGuardRoute = 'chat' | 'research' | 'document' | 'extract';

export function createTokenGuard(config: ProviderConfig, route: TokenGuardRoute) {
  const { maxInputTokens, maxOutputTokens, maxRequestCost } = config;

  return function tokenGuard(req: Request, res: Response, next: NextFunction) {
    try {
      const ip = req.ip || req.socket?.remoteAddress;

      if (route === 'chat') {
        const { messages, max_tokens } = req.body ?? {};
        if (!messages || !Array.isArray(messages)) {
          blockRequest(res, 'invalid_messages', ip);
          return res.status(400).json({ error: 'invalid_messages' });
        }
        const prompt = messages.map((m: { content?: string }) => m.content || '').join(' ');
        const estimatedInput = estimateTokensFromText(prompt);

        if (estimatedInput > maxInputTokens) {
          blockRequest(res, 'input_too_large', ip);
          return res.status(400).json({ error: 'input_too_large' });
        }

        if (max_tokens != null && max_tokens > maxOutputTokens) {
          blockRequest(res, 'output_limit_exceeded', ip);
          return res.status(400).json({ error: 'output_limit_exceeded' });
        }

        const price = calculatePrice({ service: 'research', prompt });
        if (price.baseCost > maxRequestCost) {
          blockRequest(res, 'request_cost_too_high', ip);
          return res.status(400).json({ error: 'request_cost_too_high' });
        }

        return next();
      }

      if (route === 'research') {
        const query = req.body?.query;
        if (!query || typeof query !== 'string') {
          return next();
        }
        const estimatedInput = estimateTokensFromText(query);
        if (estimatedInput > maxInputTokens) {
          blockRequest(res, 'input_too_large', ip);
          return res.status(400).json({ error: 'input_too_large' });
        }
        const price = calculatePrice({ service: 'research', prompt: query });
        if (price.baseCost > maxRequestCost) {
          blockRequest(res, 'request_cost_too_high', ip);
          return res.status(400).json({ error: 'request_cost_too_high' });
        }
        return next();
      }

      if (route === 'document') {
        const file = req.file;
        if (!file || !file.buffer) {
          return next();
        }
        const estimatedInput = Math.ceil(file.buffer.length / 10);
        if (estimatedInput > maxInputTokens) {
          blockRequest(res, 'input_too_large', ip);
          return res.status(400).json({ error: 'input_too_large' });
        }
        const price = calculatePrice({
          service: 'document',
          prompt: ' '.repeat(Math.min(file.buffer.length, 12000)),
        });
        if (price.baseCost > maxRequestCost) {
          blockRequest(res, 'request_cost_too_high', ip);
          return res.status(400).json({ error: 'request_cost_too_high' });
        }
        return next();
      }

      if (route === 'extract') {
        const url = req.body?.url;
        if (!url || typeof url !== 'string') {
          return next();
        }
        if (url.length > 2048) {
          blockRequest(res, 'input_too_large', ip);
          return res.status(400).json({ error: 'input_too_large' });
        }
        const price = calculatePrice({ service: 'extract', prompt: url });
        if (price.baseCost > maxRequestCost) {
          blockRequest(res, 'request_cost_too_high', ip);
          return res.status(400).json({ error: 'request_cost_too_high' });
        }
        return next();
      }

      next();
    } catch (err) {
      console.error('tokenGuard error', err);
      return res.status(500).json({ error: 'token_guard_failed' });
    }
  };
}
