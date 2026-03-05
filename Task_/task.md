You are modifying an existing Handshake58 provider template project.

The project already contains the Handshake58 infrastructure that handles:

* DRAIN payment verification
* voucher validation
* provider metadata
* OpenAI compatibility
* pricing endpoints
* Polygon settlement

Important rule:
DO NOT remove or modify the infrastructure files:

* drain.ts
* storage.ts
* config.ts
* constants.ts

Only extend the project.

Your task is to turn this provider into a multi-service AI provider that supports three services:

1. research provider
2. document analysis provider
3. data extraction provider

The project must remain compatible with Handshake58 Subnet 58.

---

Create the following folder structure inside src:

src/
services/
researchService.ts
documentService.ts
extractionService.ts

routes/
researchRoute.ts
documentRoute.ts
extractionRoute.ts

---

Service 1: Research Provider

Endpoint:
POST /research

Request body:
{
"query": "string"
}

Behavior:

* optionally fetch web results (use axios or a search API)
* send the information to OpenAI
* summarize research results
* return structured JSON

Example response:

{
"type": "research",
"query": "AI regulation Europe",
"summary": "...",
"key_points": [],
"sources": []
}

---

Service 2: Document Provider

Endpoint:
POST /document

Request:
multipart/form-data with a PDF file

Steps:

* parse PDF using pdf-parse
* extract text
* send text to OpenAI
* return summary and extracted insights

Example response:

{
"type": "document-analysis",
"summary": "...",
"entities": [],
"important_points": []
}

---

Service 3: Extraction Provider

Endpoint:
POST /extract

Request:

{
"url": "https://example.com"
}

Steps:

* fetch webpage with axios
* parse HTML with cheerio
* extract main text
* use OpenAI to structure data

Example response:

{
"type": "data-extraction",
"url": "example.com",
"structured_data": {}
}

---

Modify index.ts

Register the new routes:

app.use("/research", researchRoute)
app.use("/document", documentRoute)
app.use("/extract", extractionRoute)

Do not remove existing OpenAI-compatible endpoints.

---

Update /v1/models endpoint.

Add these models:

research-agent
document-analyzer
data-extractor

---

Update pricing configuration to include:

research-agent → $0.002
document-analyzer → $0.003
data-extractor → $0.002

---

Create an OpenAI client helper using the OPENAI_API_KEY environment variable.

---

Add basic error handling.

---

Add optional Redis caching layer to reduce repeated OpenAI calls.

---

Do not break compatibility with the existing provider template.

All existing infrastructure must remain functional.

---

Return the complete updated project files.
