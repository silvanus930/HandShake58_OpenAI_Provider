/**
 * Document Analysis Provider Route
 * POST /v1/document (multipart/form-data, requires X-DRAIN-Voucher)
 * Inline auth logic: voucher check → parse → estimate → validate
 */

import type { Request, Response } from 'express';
import { analyzeDocument } from '../services/documentService.js';
import type { DrainService } from '../drain.js';
import type { ProviderConfig } from '../types.js';
import { getPaymentHeaders } from '../constants.js';
import { calculateProviderPrice } from '../pricing/pricingEngine.js';
import { notifyTraffic, getClientIp } from '../lib/telegram.js';

export function createDocumentRoute(drainService: DrainService, config: ProviderConfig) {
  return async function documentHandler(req: Request, res: Response): Promise<void> {
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

    const { price } = calculateProviderPrice('document');
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
      const file = req.file;
      if (!file || !file.buffer) {
        res.status(400).json({
          error: {
            message: 'PDF file is required (multipart/form-data field: file)',
            code: 'invalid_request',
          },
        });
        return;
      }

      const result = await analyzeDocument(file.buffer);

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
      notifyTraffic('/v1/document', cost, getClientIp(req));
      const total = actualValidation.channel!.totalCharged;
      const remaining = actualValidation.channel!.deposit - total;

      res.set({
        'X-DRAIN-Cost': cost.toString(),
        'X-DRAIN-Total': total.toString(),
        'X-DRAIN-Remaining': remaining.toString(),
        'X-Provider-Speed': 'fast',
      }).json(result);

      console.log(`[drain] document drained ${cost} USDC`);
    } catch (err) {
      console.error('[document]', err);
      const message = err instanceof Error ? err.message : 'Document analysis failed';
      res.status(500).json({
        error: { message, code: 'document_error' },
      });
    }
  };
}
