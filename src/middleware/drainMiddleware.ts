/**
 * DRAIN voucher validation middleware for service and chat routes
 * Template pattern: tokenGuard -> drain -> handler (order preserved)
 */

import type { Request, Response, NextFunction } from 'express';
import type { DrainService } from '../drain.js';
import type { ProviderConfig, ModelPricing } from '../types.js';
import { getPaymentHeaders } from '../constants.js';
import { calculateProviderPrice } from '../pricing/pricingEngine.js';
import { getModelPricing, isModelSupported, getSupportedModels } from '../config.js';
import { calculateCost } from '../config.js';
import type { ChannelState } from '../types.js';
import type { Hash } from 'viem';

declare global {
  namespace Express {
    interface Request {
      drainVoucher?: { channelId: Hash; amount: string; nonce: string; signature: string };
      drainChannelState?: ChannelState;
      drainEstimatedCost?: bigint;
      /** Set for chat route: model and pricing for cost calculation */
      drainModel?: string;
      drainPricing?: ModelPricing;
    }
  }
}

type ServiceType = 'research' | 'document' | 'extract' | 'chat';

function getEstimatedCost(req: Request, serviceType: ServiceType): bigint {
  if (serviceType === 'chat') {
    const model = req.body?.model as string | undefined;
    if (!model || !isModelSupported(model)) {
      throw new Error(model ? 'UNSUPPORTED_MODEL' : 'MISSING_MODEL');
    }
    const pricing = getModelPricing(model)!;
    const estimatedInputTokens = JSON.stringify(req.body?.messages ?? []).length / 4;
    const minOutputTokens = 50;
    return calculateCost(pricing, Math.ceil(estimatedInputTokens), minOutputTokens);
  }
  const { price } = calculateProviderPrice(serviceType as 'research' | 'document' | 'extract');
  return BigInt(Math.ceil(price * 1_000_000)); // USD to USDC 6 decimals
}

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

    let estimatedCost: bigint;
    try {
      estimatedCost = getEstimatedCost(req, serviceType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'UNSUPPORTED_MODEL') {
        const model = req.body?.model as string;
        res.status(400).json({
          error: {
            message: `Model '${model}' not supported. Available: ${getSupportedModels().join(', ')}`,
            type: 'invalid_request_error',
            code: 'model_not_supported',
          },
        });
        return;
      }
      if (msg === 'MISSING_MODEL') {
        res.status(400).json({
          error: {
            message: 'model is required',
            type: 'invalid_request_error',
            code: 'model_required',
          },
        });
        return;
      }
      throw err;
    }

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
    if (serviceType === 'chat') {
      req.drainModel = req.body?.model as string;
      req.drainPricing = getModelPricing(req.drainModel)!;
    }
    next();
  };
}
