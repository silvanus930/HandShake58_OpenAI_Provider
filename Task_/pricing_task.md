You are modifying an existing Handshake58 provider project.

The project already contains:

* HS58 infrastructure
* DRAIN payment verification
* OpenAI integration
* three services:

  * research provider
  * document provider
  * extraction provider

Do NOT remove or modify core infrastructure files:

* drain.ts
* storage.ts
* config.ts
* constants.ts

You must only ADD a pricing engine.

---

Goal

Implement a real cost-based pricing strategy based on current OpenAI API pricing.

Use GPT-4o-mini as the base model.

Current OpenAI pricing:

input_tokens = $0.15 / 1,000,000 tokens
output_tokens = $0.60 / 1,000,000 tokens

---

Step 1 — Create pricing engine

Create file:

src/pricing/pricingEngine.ts

This module calculates request cost and final price.

Implementation logic:

1. Calculate base cost

cost =
(input_tokens × input_price) +
(output_tokens × output_price)

Use constants:

INPUT_TOKEN_PRICE = 0.00000015
OUTPUT_TOKEN_PRICE = 0.0000006

---

Step 2 — Dynamic margin algorithm

Add margin based on load.

Use this rule:

if requests_per_minute < 5
margin = 1.8

if requests_per_minute between 5 and 20
margin = 2.5

if requests_per_minute > 20
margin = 3.5

final_price = cost × margin

---

Step 3 — Service specific adjustments

Apply multipliers per service.

research provider:

average tokens
input = 1500
output = 700

expected cost ≈ 0.00065

target price range
0.0020 – 0.0028

---

document provider:

average tokens
input = 3000
output = 1200

expected cost ≈ 0.00117

target price range
0.0030 – 0.0045

---

extraction provider:

average tokens
input = 1200
output = 500

expected cost ≈ 0.00048

target price range
0.0015 – 0.0024

---

Step 4 — Implement helper function

function calculateProviderPrice(serviceType, rpm)

serviceType options:

research
document
extract

Use token estimates above to calculate cost.

Then apply dynamic margin.

Return final price.

---

Step 5 — Integrate into services

Update:

researchService.ts
documentService.ts
extractionService.ts

Before sending response:

calculate price using pricingEngine.

Attach pricing metadata to response:

{
"provider": "research",
"price": 0.0023,
"estimated_cost": 0.00065
}

---

Step 6 — Update pricing endpoint

Update /v1/pricing endpoint.

Return dynamic prices for providers.

Example response:

{
"providers": {
"research-agent": {
"price": 0.0023
},
"document-analyzer": {
"price": 0.0036
},
"data-extractor": {
"price": 0.0019
}
}
}

---

Step 7 — Add caching profit logic

If cached result exists:

cost = 0

price remains the same.

Profit increases.

---

Step 8 — Monitoring

Create simple metrics module:

src/pricing/metrics.ts

Track:

requests_per_minute
average_tokens
cache_hits

These metrics feed into pricingEngine.

---

Step 9 — Do NOT break compatibility

The HS58 provider must still support:

/v1/models
/v1/chat/completions
/v1/pricing

---

Final result

The provider automatically:

1. calculates OpenAI cost
2. adjusts margin dynamically
3. exposes dynamic prices
4. maximizes profit while remaining competitive.

Return full updated files.
