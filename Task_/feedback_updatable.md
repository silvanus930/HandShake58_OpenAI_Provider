You are updating a Handshake58 provider template project.

IMPORTANT RULES
- DO NOT remove or break the HS58 infrastructure.
- The following files must remain functional:
  src/drain.ts
  src/index.ts
  src/serviceModels.ts
- The provider must stay compatible with the HS58 marketplace.
- Do not modify voucher validation logic unless necessary.
- Do not remove provider registration endpoints.

Your job is to make the project deployment-safe and production-ready.

--------------------------------

TASK 1 — REMOVE .env FROM REPOSITORY

1. Delete `.env` from the repository if it exists.
2. Ensure `.env` is ignored by git.

Create or update `.gitignore` and include:

.env
.env.local
.env.production
node_modules
dist
.cache
logs

--------------------------------

TASK 2 — CREATE ENV TEMPLATE

Create a file:

.env.example

with the following variables:

PORT=3000
OPENAI_API_KEY=your_openai_api_key
PROVIDER_WALLET=your_provider_wallet
CACHE_TTL=3600
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

--------------------------------

TASK 3 — UPDATE CONFIG LOADING

Update `src/config.ts` to safely load environment variables.

Requirements:

- Use dotenv
- Provide default values
- Throw error if OPENAI_API_KEY missing

Example structure:

export const config = {
  port: process.env.PORT || 3000,
  openaiApiKey: process.env.OPENAI_API_KEY,
  providerWallet: process.env.PROVIDER_WALLET,
  cacheTTL: Number(process.env.CACHE_TTL || 3600),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 100),
  rateLimitWindow: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000)
}

if (!config.openaiApiKey) {
  throw new Error("OPENAI_API_KEY is required")
}

--------------------------------

TASK 4 — ADD RATE LIMITING

Install and implement:

express-rate-limit

Add middleware in `src/index.ts`.

Example:

const rateLimit = require("express-rate-limit")

const limiter = rateLimit({
  windowMs: config.rateLimitWindow,
  max: config.rateLimitMax,
})

app.use(limiter)

--------------------------------

TASK 5 — ADD REQUEST SIZE LIMIT

In `src/index.ts`, update express configuration:

app.use(express.json({
  limit: "2mb"
}))

--------------------------------

TASK 6 — VERIFY SERVICES ENDPOINT

Ensure `GET /services` endpoint exists and returns service metadata.

Example response:

{
  services: [
    {
      id: "research",
      name: "AI Research",
      description: "Performs AI-powered research queries",
      route: "/research"
    }
  ]
}

If missing, implement it using serviceModels.ts.

--------------------------------

TASK 7 — VERIFY PRICING ENGINE CONNECTION

Ensure service routes follow this flow:

1 Validate voucher
2 Estimate price using pricingEngine
3 Drain voucher using drain.ts
4 Execute AI service

Example flow:

const cost = pricingEngine.calculate(request)

await drain(voucher, cost)

const result = await researchService.run(request)

--------------------------------

TASK 8 — ADD OPENAI RETRY LOGIC

Update `src/lib/openaiClient.ts`.

Add retry logic for:

429 errors
network errors

Retry up to 3 times with exponential backoff.

--------------------------------

TASK 9 — ADD HEALTH CHECK

Ensure endpoint exists:

GET /health

Response:

{
  status: "ok"
}

--------------------------------

TASK 10 — VERIFY RAILWAY DEPLOYMENT

Ensure `railway.json` or package.json start script works.

Preferred:

"start": "node dist/index.js"

If project uses TypeScript, ensure build step exists:

"build": "tsc"

--------------------------------

TASK 11 — ADD BASIC LOGGING

Use simple console logging for:

- incoming request
- drained amount
- service execution time

--------------------------------

FINAL GOAL

After updates the provider should:

- be secure
- not expose secrets
- support HS58 voucher drain
- support marketplace service discovery
- be deployable on Railway

Do NOT modify core HS58 infrastructure unless required.

Return a summary of all modifications after finishing.