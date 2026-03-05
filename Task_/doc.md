You are updating a Handshake58 provider project.

IMPORTANT RULES
- Do NOT modify HS58 core infrastructure.
- Do NOT break voucher validation or drain logic.
- Keep existing routes and services intact.
- Only add documentation and metadata.

Your task is to add developer-friendly documentation to the provider.

--------------------------------------------------

TASK 1 — ADD SWAGGER DOCUMENTATION

Install required packages:

swagger-ui-express
swagger-jsdoc

Update package.json dependencies if missing.

--------------------------------------------------

TASK 2 — CREATE OPENAPI CONFIG

Create a new file:

src/docs/swagger.ts

Example structure:

import swaggerJSDoc from "swagger-jsdoc"

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "HS58 AI Provider API",
      version: "1.0.0",
      description: "AI services provider for Handshake58 marketplace"
    },
    servers: [
      {
        url: "http://localhost:3000"
      }
    ]
  },
  apis: ["./src/routes/*.ts"]
})

--------------------------------------------------

TASK 3 — ADD DOCS ROUTE

Update src/index.ts

Import swagger:

import swaggerUi from "swagger-ui-express"
import { swaggerSpec } from "./docs/swagger"

Register route:

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec))

After this change documentation must be accessible at:

/docs

--------------------------------------------------

TASK 4 — ADD SWAGGER COMMENTS TO ROUTES

For each route file:

src/routes/researchRoute.ts
src/routes/extractionRoute.ts
src/routes/documentRoute.ts

Add OpenAPI comments above the route.

Example:

/**
 * @openapi
 * /research:
 *   post:
 *     summary: AI research query
 *     description: Runs a research prompt using OpenAI models
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               voucher:
 *                 type: string
 *               query:
 *                 type: string
 *     responses:
 *       200:
 *         description: Research result
 */

--------------------------------------------------

TASK 5 — IMPROVE /services METADATA

Update the /services endpoint so each service returns:

{
  id
  name
  description
  route
  method
  inputSchema
  outputSchema
}

Example:

{
  id: "research",
  name: "AI Research",
  description: "AI-powered research queries",
  route: "/research",
  method: "POST",
  inputSchema: {
    query: "string"
  },
  outputSchema: {
    result: "string"
  }
}

--------------------------------------------------

TASK 6 — GENERATE README.md

Create a README.md file describing the provider.

Include sections:

1. Overview
2. Installation
3. Environment Variables
4. Available Services
5. Example Requests
6. Documentation URL
7. Health Check

Example environment variables section:

OPENAI_API_KEY=your_key
PROVIDER_WALLET=wallet
PORT=3000

Mention documentation endpoint:

http://localhost:3000/docs

--------------------------------------------------

TASK 7 — VERIFY PROVIDER HEALTH

Ensure endpoint exists:

GET /health

Response:

{
  "status": "ok"
}

--------------------------------------------------

FINAL RESULT

After completing the tasks the provider must support:

/services
/docs
/health

Swagger UI should load at:

http://localhost:3000/docs

Do not change core HS58 logic or pricing engine.
Return a summary of changes after completion.