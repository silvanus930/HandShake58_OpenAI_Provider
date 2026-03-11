/**
 * Research Provider Route
 * POST /v1/research (requires X-DRAIN-Voucher)
 * Inline auth logic: voucher check → parse → estimate → validate
 */

import type { Request, Response } from 'express';
import { runResearch } from '../services/researchService.js';
import type { DrainService } from '../drain.js';
import type { ProviderConfig } from '../types.js';
import { getPaymentHeaders } from '../constants.js';
import { calculateProviderPrice } from '../pricing/pricingEngine.js';
import { notifyTraffic } from '../lib/telegram.js';

export function createResearchRoute(drainService: DrainService, config: ProviderConfig) {
  return async function researchHandler(req: Request, res: Response): Promise<void> {
    const voucherHeader = req.headers['x-drain-voucher'] as string | undefined;

    if (!voucherHeader) {
      res.status(402).set(getPaymentHeaders(drainService.getProviderAddress(), config.chainId)).json({
        error: {
          message: 'X-DRAIN-Voucher header required',
          type: 'payment_required',
          code: 'voucher_required',
        },
      });
      return;
    }

    const voucher = drainService.parseVoucherHeader(voucherHeader);
    if (!voucher) {
      res.status(402).set({ 'X-DRAIN-Error': 'invalid_voucher_format' }).json({
        error: {
          message: 'Invalid X-DRAIN-Voucher format',
          type: 'payment_required',
          code: 'invalid_voucher_format',
        },
      });
      return;
    }

    const { price } = calculateProviderPrice('research');
    const estimatedCost = BigInt(Math.ceil(price * 1_000_000));

    const validation = await drainService.validateVoucher(voucher, estimatedCost);

    if (!validation.valid) {
      const errorHeaders: Record<string, string> = { 'X-DRAIN-Error': validation.error! };
      if (validation.error === 'insufficient_funds' && validation.channel) {
        errorHeaders['X-DRAIN-Required'] = estimatedCost.toString();
        errorHeaders['X-DRAIN-Provided'] = (BigInt(voucher.amount) - validation.channel.totalCharged).toString();
      }
      res.status(402).set(errorHeaders).json({
        error: {
          message: `Payment validation failed: ${validation.error}`,
          type: 'payment_required',
          code: validation.error,
        },
      });
      return;
    }

    try {
      const { query } = req.body ?? {};
      if (!query || typeof query !== 'string') {
        res.status(400).json({
          error: { message: 'query (string) is required', code: 'invalid_request' },
        });
        return;
      }

      const result = await runResearch(query);

      const actualPrice = result.pricing?.price ?? 0;
      const cost = BigInt(Math.ceil(actualPrice * 1_000_000));

      const actualValidation = await drainService.validateVoucher(voucher, cost);
      if (!actualValidation.valid) {
        res.status(402).set({
          'X-DRAIN-Error': actualValidation.error ?? 'insufficient_funds_post',
          'X-DRAIN-Required': cost.toString(),
        }).json({
          error: {
            message: `Payment insufficient for actual cost: ${actualValidation.error}`,
            type: 'payment_required',
            code: actualValidation.error ?? 'insufficient_funds_post',
          },
        });
        return;
      }

      drainService.storeVoucher(voucher, actualValidation.channel!, cost);
      notifyTraffic('/v1/research', cost);
      const total = actualValidation.channel!.totalCharged;
      const remaining = actualValidation.channel!.deposit - total;

      res.set({
        'X-DRAIN-Cost': cost.toString(),
        'X-DRAIN-Total': total.toString(),
        'X-DRAIN-Remaining': remaining.toString(),
        'X-Provider-Speed': 'fast',
      }).json(result);

      console.log(`[drain] research drained ${cost} USDC`);
    } catch (err) {
      console.error('[research]', err);
      const message = err instanceof Error ? err.message : 'Research failed';
      res.status(500).json({
        error: { message, code: 'research_error' },
      });
    }
  };
}
