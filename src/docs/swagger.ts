/**
 * OpenAPI / Swagger configuration for HS58 AI Provider
 */

import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'HS58 AI Provider API',
      version: '1.0.0',
      description: 'AI services provider for Handshake58 marketplace. All service routes require X-DRAIN-Voucher header for payment.',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
    components: {
      securitySchemes: {
        DrainVoucher: {
          type: 'apiKey',
          in: 'header',
          name: 'X-DRAIN-Voucher',
          description: 'DRAIN protocol voucher (JSON) for payment',
        },
      },
      schemas: {
        ResearchRequest: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Research query' },
          },
        },
        ResearchResponse: {
          type: 'object',
          properties: {
            type: { type: 'string', example: 'research' },
            query: { type: 'string' },
            summary: { type: 'string' },
            key_points: { type: 'array', items: { type: 'string' } },
            sources: { type: 'array', items: { type: 'string' } },
            pricing: {
              type: 'object',
              properties: {
                provider: { type: 'string' },
                price: { type: 'number' },
                estimated_cost: { type: 'number' },
              },
            },
          },
        },
        ExtractRequest: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', format: 'uri', description: 'URL to extract content from' },
          },
        },
        ExtractResponse: {
          type: 'object',
          properties: {
            type: { type: 'string', example: 'data-extraction' },
            url: { type: 'string' },
            extraction_method: { type: 'string', enum: ['static', 'dynamic'] },
            extracted_text_length: { type: 'number' },
            structured_data: { type: 'object' },
            pricing: {
              type: 'object',
              properties: {
                provider: { type: 'string' },
                price: { type: 'number' },
                estimated_cost: { type: 'number' },
              },
            },
          },
        },
        DocumentResponse: {
          type: 'object',
          properties: {
            type: { type: 'string', example: 'document-analysis' },
            summary: { type: 'string' },
            entities: { type: 'array', items: { type: 'string' } },
            important_points: { type: 'array', items: { type: 'string' } },
            pricing: {
              type: 'object',
              properties: {
                provider: { type: 'string' },
                price: { type: 'number' },
                estimated_cost: { type: 'number' },
              },
            },
          },
        },
      },
    },
    security: [{ DrainVoucher: [] }],
    paths: {
      '/research': {
        post: {
          summary: 'AI research query',
          description: 'Runs a research prompt using OpenAI models. Requires X-DRAIN-Voucher header.',
          tags: ['Services'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ResearchRequest' },
              },
            },
          },
          responses: {
            200: { description: 'Research result', content: { 'application/json': { schema: { $ref: '#/components/schemas/ResearchResponse' } } } },
            400: { description: 'Invalid request' },
            402: { description: 'Payment required (voucher missing or invalid)' },
            500: { description: 'Service error' },
          },
        },
      },
      '/document': {
        post: {
          summary: 'Document analysis',
          description: 'Analyzes PDF document and extracts insights. Requires X-DRAIN-Voucher header. Send as multipart/form-data with file field.',
          tags: ['Services'],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: { type: 'string', format: 'binary', description: 'PDF file' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Document analysis result', content: { 'application/json': { schema: { $ref: '#/components/schemas/DocumentResponse' } } } },
            400: { description: 'Invalid request (PDF required)' },
            402: { description: 'Payment required' },
            500: { description: 'Service error' },
          },
        },
      },
      '/extract': {
        post: {
          summary: 'Web page extraction',
          description: 'Extracts structured data from a URL. Supports static and JavaScript-rendered pages. Requires X-DRAIN-Voucher header.',
          tags: ['Services'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ExtractRequest' },
              },
            },
          },
          responses: {
            200: { description: 'Extraction result', content: { 'application/json': { schema: { $ref: '#/components/schemas/ExtractResponse' } } } },
            400: { description: 'Invalid URL' },
            402: { description: 'Payment required' },
            422: { description: 'Content could not be extracted' },
            500: { description: 'Service error' },
          },
        },
      },
      '/metadata': {
        get: {
          summary: 'Provider metadata',
          description: 'Provider metadata for router discovery.',
          tags: ['Discovery'],
          responses: {
            200: { description: 'Provider metadata' },
          },
        },
      },
      '/services': {
        get: {
          summary: 'List services',
          description: 'Returns metadata for all available AI services.',
          tags: ['Discovery'],
          responses: {
            200: { description: 'List of services' },
          },
        },
      },
      '/health': {
        get: {
          summary: 'Health check',
          description: 'Returns provider health status.',
          tags: ['Discovery'],
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } } } },
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
