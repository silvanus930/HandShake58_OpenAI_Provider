/**
 * Chat Completions Route
 * POST /v1/chat/completions (requires X-DRAIN-Voucher)
 * Inline auth logic: voucher check → parse → model check → estimate → validate
 */

import type { Request, Response } from 'express';
import type OpenAI from 'openai';
import type { DrainService } from '../drain.js';
import type { ProviderConfig } from '../types.js';
import { getPaymentHeaders } from '../constants.js';
import { calculateCost, getModelPricing, isModelSupported, getSupportedModels } from '../config.js';
import { withOpenAIRetry } from '../lib/openaiClient.js';
import { notifyTraffic } from '../lib/telegram.js';

export function createChatRoute(drainService: DrainService, config: ProviderConfig, openai: OpenAI) {
  return async function chatHandler(req: Request, res: Response): Promise<void> {
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

    const model = req.body?.model as string | undefined;
    const messages = req.body?.messages;
    if (!model) {
      res.status(400).json({
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
          code: 'model_required',
        },
      });
      return;
    }
    if (!isModelSupported(model)) {
      res.status(400).json({
        error: {
          message: `Model '${model}' not supported. Available: ${getSupportedModels().join(', ')}`,
          type: 'invalid_request_error',
          code: 'model_not_supported',
        },
      });
      return;
    }
    if (!Array.isArray(messages)) {
      res.status(400).json({
        error: {
          message: 'messages (array) is required',
          type: 'invalid_request_error',
          code: 'messages_required',
        },
      });
      return;
    }

    const pricing = getModelPricing(model)!;
    const isStreaming = req.body.stream === true;

    const estimatedInputTokens = JSON.stringify(messages ?? []).length / 4;
    const minOutputTokens = 50;
    const estimatedMinCost = calculateCost(pricing, Math.ceil(estimatedInputTokens), minOutputTokens);

    const validation = await drainService.validateVoucher(voucher, estimatedMinCost);

    if (!validation.valid) {
      const errorHeaders: Record<string, string> = { 'X-DRAIN-Error': validation.error! };
      if (validation.error === 'insufficient_funds' && validation.channel) {
        errorHeaders['X-DRAIN-Required'] = estimatedMinCost.toString();
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

    const channelState = validation.channel!;
    let voucherStored = false;

    try {
      if (isStreaming) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-DRAIN-Channel', voucher.channelId);

        let inputTokens = 0;
        let outputTokens = 0;
        let fullContent = '';

        const stream = await withOpenAIRetry(() =>
          openai.chat.completions.create({
            model,
            messages,
            max_tokens: req.body.max_tokens,
            stream: true,
          })
        );

        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            fullContent += content;
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            if ((chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage) {
              const usage = (chunk as any).usage;
              inputTokens = usage.prompt_tokens || 0;
              outputTokens = usage.completion_tokens || 0;
            }
          }
        } catch (streamErr) {
          if (!voucherStored && fullContent.length > 0) {
            inputTokens = inputTokens || Math.ceil(JSON.stringify(messages ?? []).length / 4);
            outputTokens = outputTokens || Math.ceil(fullContent.length / 4);
            const cost = calculateCost(pricing, inputTokens, outputTokens);
            const recheck = await drainService.validateVoucher(voucher, cost);
            if (recheck.valid) {
              drainService.storeVoucher(voucher, channelState, cost);
              voucherStored = true;
              notifyTraffic('/v1/chat/completions', cost);
              console.log(`[drain] chat drained ${cost} USDC (stream interrupted)`);
            }
          }
          throw streamErr;
        }

        if (inputTokens === 0) inputTokens = Math.ceil(JSON.stringify(messages ?? []).length / 4);
        if (outputTokens === 0) outputTokens = Math.ceil(fullContent.length / 4);

        const actualCost = calculateCost(pricing, inputTokens, outputTokens);
        drainService.storeVoucher(voucher, channelState, actualCost);
        voucherStored = true;
        notifyTraffic('/v1/chat/completions', actualCost);
        console.log(`[drain] chat drained ${actualCost} USDC`);

        const total = channelState.totalCharged;
        const remaining = channelState.deposit - total;
        res.write(`data: [DONE]\n\n`);
        res.write(`: X-DRAIN-Cost: ${actualCost.toString()}\n`);
        res.write(`: X-DRAIN-Total: ${total.toString()}\n`);
        res.write(`: X-DRAIN-Remaining: ${remaining.toString()}\n`);
        res.end();
      } else {
        const completion = await withOpenAIRetry(() =>
          openai.chat.completions.create({
            model,
            messages,
            max_tokens: req.body.max_tokens,
          })
        );

        const inputTokens = completion.usage?.prompt_tokens ?? 0;
        const outputTokens = completion.usage?.completion_tokens ?? 0;
        const actualCost = calculateCost(pricing, inputTokens, outputTokens);

        const actualValidation = await drainService.validateVoucher(voucher, actualCost);

        if (!actualValidation.valid) {
          res.status(402).set({
            'X-DRAIN-Error': 'insufficient_funds_post',
            'X-DRAIN-Required': actualCost.toString(),
          }).json({
            error: {
              message: 'Voucher insufficient for actual cost',
              type: 'payment_required',
              code: 'insufficient_funds_post',
            },
          });
          return;
        }

        drainService.storeVoucher(voucher, actualValidation.channel!, actualCost);
        notifyTraffic('/v1/chat/completions', actualCost);
        console.log(`[drain] chat drained ${actualCost} USDC`);

        const total = actualValidation.channel!.totalCharged;
        const remaining = actualValidation.channel!.deposit - total;

        res.set({
          'X-DRAIN-Cost': actualCost.toString(),
          'X-DRAIN-Total': total.toString(),
          'X-DRAIN-Remaining': remaining.toString(),
          'X-DRAIN-Channel': voucher.channelId,
        }).json(completion);
      }
    } catch (error) {
      console.error('OpenAI API error:', error);
      if (!res.headersSent) {
        const message = error instanceof Error ? error.message : 'OpenAI API error';
        res.status(500).json({
          error: { message, type: 'api_error', code: 'openai_error' },
        });
      } else {
        res.end();
      }
    }
  };
}
