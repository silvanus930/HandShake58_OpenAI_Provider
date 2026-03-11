/**
 * HS58-OpenAI Provider
 * Minimal, no-bloat DRAIN payment proxy for OpenAI.
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';
import { loadConfig, getModelPricing, getSupportedModels, loadModels } from './config.js';
import { DrainService } from './drain.js';
import { VoucherStorage } from './storage.js';
import { formatUnits } from 'viem';
import { SERVICE_MODELS, getServiceModelPricing, SERVICE_METADATA } from './serviceModels.js';
import { calculateProviderPrice, SERVICE_TO_PROVIDER } from './pricing/pricingEngine.js';
import { createResearchRoute } from './routes/researchRoute.js';
import { createDocumentRoute } from './routes/documentRoute.js';
import multer from 'multer';
import { createExtractionRoute } from './routes/extractionRoute.js';
import { createChatRoute } from './routes/chatRoute.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './docs/swagger.js';
import { initTelegram, notifyStartup, notifyVisit } from './lib/telegram.js';

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
    const costHeader = res.getHeader('X-DRAIN-Cost');
    if (costHeader) logData.price = costHeader;
    console.log(JSON.stringify(logData));
    if (req.method === 'GET' && ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 304)) {
      notifyVisit(req.path);
    }
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

// Inline auth logic: voucher check → parse → estimate → validate
app.post('/v1/research', createResearchRoute(drainService, config));
app.post('/v1/document', documentUpload.single('file'), createDocumentRoute(drainService, config));
app.post('/v1/extract', createExtractionRoute(drainService, config));
app.post('/v1/chat/completions', createChatRoute(drainService, config, openai));

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
  const models = [...SERVICE_MODELS, ...getSupportedModels()];
  res.type('text/plain').send(
    `# ${config.providerName}

Standard OpenAI-compatible chat completions API. Payment via DRAIN protocol.
All endpoints require X-DRAIN-Voucher header.

## Services

- POST /v1/research - AI research (query)
- POST /v1/document - Document analysis (PDF multipart)
- POST /v1/extract - Data extraction (url)

## Request Formats

### POST /v1/chat/completions
Content-Type: application/json
Header: X-DRAIN-Voucher (required)

{
  "model": "<model-id>",
  "messages": [{"role": "user", "content": "Your message"}],
  "stream": false
}

### POST /v1/research
Content-Type: application/json
Header: X-DRAIN-Voucher (required)

{
  "query": "Your research question"
}

### POST /v1/document
Content-Type: multipart/form-data
Header: X-DRAIN-Voucher (required)

file: <PDF binary>

### POST /v1/extract
Content-Type: application/json
Header: X-DRAIN-Voucher (required)

{
  "url": "https://example.com"
}

## Available Models (${models.length})

${models.join('\n')}

## Pricing

GET /v1/pricing for per-model token pricing.`
  );
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
  } catch (error) {
    console.error('[close-channel] Error:', error instanceof Error ? error.message : error);
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
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Start server
async function start() {
  initTelegram();
  await loadModels(config.openaiApiKey, config.markup, config.marketplaceUrl);

  // Start auto-claim
  drainService.startAutoClaim(config.autoClaimIntervalMinutes, config.autoClaimBufferSeconds);
  
  app.listen(config.port, config.host, () => {
    console.log(`${config.providerName} | ${getSupportedModels().length} models | ${(config.markup - 1) * 100}% markup | http://${config.host}:${config.port}`);
    console.log(`Auto-claim active: checking every ${config.autoClaimIntervalMinutes}min, buffer ${config.autoClaimBufferSeconds}s`);
    notifyStartup(config.providerName, getSupportedModels().length, config.port, config.host);
  });
}

start().catch(e => { console.error('❌', e instanceof Error ? e.message : String(e)); process.exit(1); });
