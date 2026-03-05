/**
 * HS58-OpenAI Provider
 * Minimal, no-bloat DRAIN payment proxy for OpenAI.
 */

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';
import { loadConfig, calculateCost, getModelPricing, isModelSupported, getSupportedModels, loadModels } from './config.js';
import { DrainService } from './drain.js';
import { VoucherStorage } from './storage.js';
import { getPaymentHeaders } from './constants.js';
import { formatUnits } from 'viem';
import { SERVICE_MODELS, getServiceModelPricing, SERVICE_METADATA } from './serviceModels.js';
import { calculateProviderPrice, SERVICE_TO_PROVIDER } from './pricing/pricingEngine.js';
import { createDrainMiddleware } from './middleware/drainMiddleware.js';
import { createTokenGuard } from './middleware/tokenGuard.js';
import { createResearchRoute } from './routes/researchRoute.js';
import { createDocumentRoute } from './routes/documentRoute.js';
import multer from 'multer';
import { createExtractionRoute } from './routes/extractionRoute.js';
import { withOpenAIRetry } from './lib/openaiClient.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './docs/swagger.js';

// Load configuration
const config = loadConfig();

// Initialize services
const storage = new VoucherStorage(config.storagePath);
const drainService = new DrainService(config, storage);

// OpenAI client (standard URL)
const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

// Create Express app
const app = express();
app.use(
  cors({
    origin: [
      'http://localhost:8080',
      'http://127.0.0.1:8080',
      ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()) : []),
    ].filter(Boolean),
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({
  windowMs: config.rateLimitWindow,
  max: config.rateLimitMax,
});
app.use(limiter);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const executionTime = Date.now() - start;
    const logData: Record<string, unknown> = {
      method: req.method,
      route: req.path,
      statusCode: res.statusCode,
      executionTime: `${executionTime}ms`,
    };
    if (res.getHeader('X-DRAIN-Cost')) {
      logData.price = res.getHeader('X-DRAIN-Cost');
    }
    console.log(JSON.stringify(logData));
  });
  next();
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      file.originalname?.toLowerCase().endsWith('.pdf');
    cb(ok ? null : new Error('Only PDF files are allowed'));
  },
});

// Multi-service routes: tokenGuard -> drain -> handler (order preserved)
app.use('/research', createTokenGuard(config, 'research'), createDrainMiddleware(drainService, config, 'research'), createResearchRoute(drainService));
app.use('/document', documentUpload.single('file'), createTokenGuard(config, 'document'), createDrainMiddleware(drainService, config, 'document'), createDocumentRoute(drainService));
app.use('/extract', createTokenGuard(config, 'extract'), createDrainMiddleware(drainService, config, 'extract'), createExtractionRoute(drainService));

app.get('/metadata', (_req, res) => {
  res.setHeader('X-Provider-Speed', 'fast');
  res.json({
    provider: config.providerName,
    version: '1.0.0',
    services: SERVICE_METADATA.map((s) => s.id),
    models: [...getSupportedModels(), ...SERVICE_MODELS],
    cache: !!process.env.REDIS_URL,
    streaming: true,
    pricing: 'dynamic',
    documentation: '/docs',
    health: '/health',
  });
});

app.get('/services', (_req, res) => {
  res.setHeader('X-Provider-Speed', 'fast');
  res.json({
    services: SERVICE_METADATA.map(
      ({ id, name, description, route, method, inputSchema, outputSchema }) => ({
        id,
        name,
        description,
        route,
        method,
        inputSchema,
        outputSchema,
      })
    ),
  });
});

app.get('/v1/docs', (req, res) => {
  const models = [...getSupportedModels(), ...SERVICE_MODELS];
  res.type('text/plain').send(`# ${config.providerName}\n\nStandard OpenAI-compatible chat completions API. Payment via DRAIN protocol.\n\n## Services\n\n- POST /research - Research provider (query)\n- POST /document - Document analysis (PDF multipart)\n- POST /extract - Data extraction (url)\n\n## Request Format\n\nPOST /v1/chat/completions\nHeader: X-DRAIN-Voucher (required)\n\n{\n  "model": "<model-id>",\n  "messages": [{"role": "user", "content": "Your message"}],\n  "stream": false\n}\n\n## Available Models (${models.length})\n\n${models.join('\n')}\n\n## Pricing\n\nGET /v1/pricing for per-model token pricing.\n`);
});

/**
 * GET /v1/pricing
 * Returns pricing information for all models
 */
app.get('/v1/pricing', (req, res) => {
  const pricing: Record<string, { inputPer1kTokens: string; outputPer1kTokens: string }> = {};
  
  const allModels = [...getSupportedModels(), ...SERVICE_MODELS];
  for (const model of allModels) {
    const modelPricing = getModelPricing(model) ?? getServiceModelPricing(model);
    if (modelPricing) {
      pricing[model] = {
        inputPer1kTokens: formatUnits(modelPricing.inputPer1k, 6),
        outputPer1kTokens: formatUnits(modelPricing.outputPer1k, 6),
      };
    }
  }

  const providers: Record<string, { price: number }> = {};
  for (const [serviceType, providerId] of Object.entries(SERVICE_TO_PROVIDER)) {
    const { price } = calculateProviderPrice(serviceType as 'research' | 'document' | 'extract');
    providers[providerId] = { price };
  }

  res.json({
    provider: drainService.getProviderAddress(),
    providerName: config.providerName,
    chainId: config.chainId,
    currency: 'USDC',
    decimals: 6,
    markup: `${(config.markup - 1) * 100}%`,
    models: pricing,
    providers,
  });
});

/**
 * GET /v1/models
 * OpenAI-compatible models endpoint
 */
app.get('/v1/models', (req, res) => {
  const allModels = [...getSupportedModels(), ...SERVICE_MODELS];
  const models = allModels.map(id => ({
    id,
    object: 'model' as const,
    created: Date.now(),
    owned_by: config.providerName.toLowerCase(),
  }));

  res.json({
    object: 'list',
    data: models,
  });
});

/**
 * POST /v1/chat/completions
 * OpenAI-compatible chat endpoint with DRAIN payments
 */
app.post('/v1/chat/completions', createTokenGuard(config, 'chat'), async (req, res) => {
  const voucherHeader = req.headers['x-drain-voucher'] as string | undefined;
  
  // 1. Check voucher header present
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

  // 2. Parse voucher
  const voucher = drainService.parseVoucherHeader(voucherHeader);
  if (!voucher) {
    res.status(402).set({
      'X-DRAIN-Error': 'invalid_voucher_format',
    }).json({
      error: {
        message: 'Invalid X-DRAIN-Voucher format',
        type: 'payment_required',
        code: 'invalid_voucher_format',
      },
    });
    return;
  }

  // 3. Check model supported
  const model = req.body.model as string;
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

  const pricing = getModelPricing(model)!;
  const isStreaming = req.body.stream === true;

  // 4. Pre-auth check: estimate minimum cost
  const estimatedInputTokens = JSON.stringify(req.body.messages).length / 4;
  const minOutputTokens = 50;
  const estimatedMinCost = calculateCost(pricing, Math.ceil(estimatedInputTokens), minOutputTokens);

  // 5. Validate voucher with estimated cost
  const validation = await drainService.validateVoucher(voucher, estimatedMinCost);
  
  if (!validation.valid) {
    const errorHeaders: Record<string, string> = {
      'X-DRAIN-Error': validation.error!,
    };
    
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

  try {
    if (isStreaming) {
      // === STREAMING RESPONSE ===
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-DRAIN-Channel', voucher.channelId);
      res.setHeader('X-Provider-Speed', 'fast');

      let inputTokens = 0;
      let outputTokens = 0;
      let fullContent = '';

      const stream = await withOpenAIRetry(() =>
        openai.chat.completions.create({
          model: model,
          messages: req.body.messages,
          max_tokens: req.body.max_tokens,
          stream: true,
        })
      );

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        fullContent += content;
        
        // Forward chunk as-is (already OpenAI format)
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        
        // Track usage if available
        if ((chunk as any).usage) {
          inputTokens = (chunk as any).usage.prompt_tokens || 0;
          outputTokens = (chunk as any).usage.completion_tokens || 0;
        }
      }

      // Estimate tokens if not provided
      if (inputTokens === 0) {
        inputTokens = Math.ceil(JSON.stringify(req.body.messages).length / 4);
      }
      if (outputTokens === 0) {
        outputTokens = Math.ceil(fullContent.length / 4);
      }

      // Calculate final cost
      const actualCost = calculateCost(pricing, inputTokens, outputTokens);
      
      // Store voucher with actual cost
      drainService.storeVoucher(voucher, channelState, actualCost);
      console.log(`[drain] chat drained ${actualCost} USDC`);

      // Send cost info
      const remaining = channelState.deposit - channelState.totalCharged - actualCost;
      res.write(`data: [DONE]\n\n`);
      res.write(`: X-DRAIN-Cost: ${actualCost.toString()}\n`);
      res.write(`: X-DRAIN-Total: ${(channelState.totalCharged + actualCost).toString()}\n`);
      res.write(`: X-DRAIN-Remaining: ${remaining.toString()}\n`);
      
      res.end();

    } else {
      // === NON-STREAMING RESPONSE ===
      const completion = await withOpenAIRetry(() =>
        openai.chat.completions.create({
          model: model,
          messages: req.body.messages,
          max_tokens: req.body.max_tokens,
        })
      );

      // Get actual token counts
      const inputTokens = completion.usage?.prompt_tokens ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;

      // Calculate actual cost
      const actualCost = calculateCost(pricing, inputTokens, outputTokens);

      // Verify voucher covers actual cost
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

      // Store voucher
      drainService.storeVoucher(voucher, channelState, actualCost);
      console.log(`[drain] chat drained ${actualCost} USDC`);

      // Calculate remaining
      const remaining = channelState.deposit - channelState.totalCharged - actualCost;

      // Send response (already OpenAI format)
      res.set({
        'X-DRAIN-Cost': actualCost.toString(),
        'X-DRAIN-Total': (channelState.totalCharged + actualCost).toString(),
        'X-DRAIN-Remaining': remaining.toString(),
        'X-DRAIN-Channel': voucher.channelId,
        'X-Provider-Speed': 'fast',
      }).json(completion);
    }
  } catch (error) {
    console.error('OpenAI API error:', error);
    
    const message = error instanceof Error ? error.message : 'OpenAI API error';
    res.status(500).json({
      error: {
        message,
        type: 'api_error',
        code: 'openai_error',
      },
    });
  }
});

/**
 * POST /v1/admin/claim
 * Trigger payment claims
 */
app.post('/v1/admin/claim', async (req, res) => {
  try {
    const forceAll = req.query.force === 'true';
    const txHashes = await drainService.claimPayments(forceAll);
    res.json({
      success: true,
      claimed: txHashes.length,
      transactions: txHashes,
      forced: forceAll,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Claim failed',
    });
  }
});

/**
 * GET /v1/admin/stats
 * Get provider statistics
 */
app.get('/v1/admin/stats', (req, res) => {
  const stats = storage.getStats();
  res.json({
    provider: drainService.getProviderAddress(),
    providerName: config.providerName,
    chainId: config.chainId,
    ...stats,
    totalEarned: formatUnits(stats.totalEarned, 6) + ' USDC',
    claimThreshold: formatUnits(config.claimThreshold, 6) + ' USDC',
  });
});

/**
 * GET /v1/admin/vouchers
 * Get pending vouchers
 */
app.get('/v1/admin/vouchers', (req, res) => {
  const unclaimed = storage.getUnclaimedVouchers();
  const highest = storage.getHighestVoucherPerChannel();
  
  res.json({
    provider: drainService.getProviderAddress(),
    providerName: config.providerName,
    unclaimedCount: unclaimed.length,
    channels: Array.from(highest.entries()).map(([channelId, voucher]) => ({
      channelId,
      amount: formatUnits(voucher.amount, 6) + ' USDC',
      amountRaw: voucher.amount.toString(),
      nonce: voucher.nonce.toString(),
      consumer: voucher.consumer,
      claimed: voucher.claimed,
      receivedAt: new Date(voucher.receivedAt).toISOString(),
    })),
  });
});

app.post('/v1/close-channel', async (req, res) => {
  try {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId required' });

    const result = await drainService.signCloseAuthorization(channelId);
    res.json({
      channelId,
      finalAmount: result.finalAmount.toString(),
      signature: result.signature,
    });
  } catch (error: any) {
    console.error('[close-channel] Error:', error?.message || error);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * Health check
 */
app.get('/health', (_req, res) => {
  res.setHeader('X-Provider-Speed', 'fast');
  res.json({
    status: 'ok',
    provider: drainService.getProviderAddress(),
    providerName: config.providerName,
  });
});

/**
 * POST /v1/admin/refresh-models
 * Refresh models from API + Marketplace pricing
 */
app.post('/v1/admin/refresh-models', async (req, res) => {
  try {
    await loadModels(config.openaiApiKey, config.markup, config.marketplaceUrl);
    res.json({ success: true, models: getSupportedModels().length });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
async function start() {
  await loadModels(config.openaiApiKey, config.markup, config.marketplaceUrl);
  
  // Start auto-claim
  drainService.startAutoClaim(config.autoClaimIntervalMinutes, config.autoClaimBufferSeconds);
  
  app.listen(config.port, config.host, () => {
    console.log(`${config.providerName} | ${getSupportedModels().length} models | ${(config.markup - 1) * 100}% markup | http://${config.host}:${config.port}`);
    console.log(`Auto-claim active: checking every ${config.autoClaimIntervalMinutes}min, buffer ${config.autoClaimBufferSeconds}s`);
  });
}

start().catch(e => { console.error('❌', e.message); process.exit(1); });
