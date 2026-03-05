/**
 * DRAIN voucher validation middleware for service routes
 */

import type { Request, Response, NextFunction } from 'express';
import type { DrainService } from '../drain.js';
import type { ProviderConfig } from '../types.js';
import { getPaymentHeaders } from '../constants.js';
import { calculateProviderPrice } from '../pricing/pricingEngine.js';
import type { ChannelState } from '../types.js';
import type { Hash } from 'viem';

declare global {
  namespace Express {
    interface Request {
      drainVoucher?: { channelId: Hash; amount: string; nonce: string; signature: string };
      drainChannelState?: ChannelState;
      drainEstimatedCost?: bigint;
    }
  }
}

type ServiceType = 'research' | 'document' | 'extract';

export function createDrainMiddleware(
  drainService: DrainService,
  config: ProviderConfig,
  serviceType: ServiceType
) {
  return async function drainMiddleware(req: Request, res: Response, next: NextFunction) {
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

    const { price } = calculateProviderPrice(serviceType);
    const estimatedCost = BigInt(Math.ceil(price * 1_000_000)); // USD to USDC 6 decimals

    const validation = await drainService.validateVoucher(voucher, estimatedCost);
    if (!validation.valid) {
      const errorHeaders: Record<string, string> = { 'X-DRAIN-Error': validation.error! };
      if (validation.error === 'insufficient_funds' && validation.channel) {
        errorHeaders['X-DRAIN-Required'] = estimatedCost.toString();
        errorHeaders['X-DRAIN-Provided'] = (
          BigInt(voucher.amount) - validation.channel.totalCharged
        ).toString();
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

    req.drainVoucher = voucher;
    req.drainChannelState = validation.channel!;
    req.drainEstimatedCost = estimatedCost;
    next();
  };
}
