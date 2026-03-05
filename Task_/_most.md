You are updating a Handshake58 provider project.

IMPORTANT RULES
- Do NOT modify HS58 infrastructure.
- Do NOT modify voucher validation or drain logic.
- Only modify the pricing engine.
- Keep compatibility with existing services.

Your goal is to upgrade src/pricing/pricingEngine.ts to support:

1 dynamic margins
2 demand-based pricing
3 token estimation
4 cache-aware profit tracking
5 modern OpenAI pricing

--------------------------------------------------

TASK 1 — DEFINE TOKEN COST CONSTANTS

Add constants for modern OpenAI pricing.

Example:

const MODEL_PRICING = {
  "gpt-4o": {
    input: 0.000005,
    output: 0.000015
  },
  "gpt-4o-mini": {
    input: 0.00000015,
    output: 0.0000006
  }
}

--------------------------------------------------

TASK 2 — DEFINE SERVICE MARGINS

Create margin multipliers per service.

Example:

const SERVICE_MARGINS = {
  research: 3.0,
  extract: 4.0,
  document: 3.5
}

--------------------------------------------------

TASK 3 — ADD TOKEN ESTIMATION

Add helper function:

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}

--------------------------------------------------

TASK 4 — ADD DEMAND MULTIPLIER

Add demand-based multiplier.

Example:

function getDemandMultiplier(activeRequests: number) {

  if (activeRequests > 20) return 1.4
  if (activeRequests > 10) return 1.2

  return 1.0
}

--------------------------------------------------

TASK 5 — ADD CACHE-AWARE PRICING

If request is cached:

OpenAI cost = 0

But keep margin price.

Example logic:

if (isCached) {
  return estimatedPrice
}

--------------------------------------------------

TASK 6 — FINAL PRICE CALCULATION

Structure calculation like:

function calculatePrice({
  service,
  prompt,
  model = "gpt-4o-mini",
  activeRequests = 0,
  isCached = false
}) {

  const tokens = estimateTokens(prompt)

  const pricing = MODEL_PRICING[model]

  const baseCost =
    tokens * pricing.input +
    tokens * pricing.output

  const margin = SERVICE_MARGINS[service] || 3

  const demand = getDemandMultiplier(activeRequests)

  const finalPrice = baseCost * margin * demand

  return {
    tokens,
    baseCost,
    margin,
    demand,
    finalPrice
  }
}

--------------------------------------------------

TASK 7 — EXPORT CLEAN API

Export:

calculatePrice()

Example usage by routes:

const price = pricingEngine.calculatePrice({
  service: "research",
  prompt: query
})

--------------------------------------------------

TASK 8 — ADD OPTIONAL LOGGING

Add debug logging:

console.log({
  service,
  tokens,
  baseCost,
  margin,
  demand,
  finalPrice
})

--------------------------------------------------

FINAL RESULT

The pricing engine must support:

- modern OpenAI costs
- dynamic margins
- demand multipliers
- token estimation
- cache-aware profit

Return the full updated pricingEngine.ts file when complete.