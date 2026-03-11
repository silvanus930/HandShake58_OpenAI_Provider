/**
 * Service models (research-agent, document-analyzer, data-extractor)
 * Pricing: per 1k tokens, USDC 6 decimals
 * research-agent: $0.002 | document-analyzer: $0.003 | data-extractor: $0.002
 */

import type { ModelPricing } from './types.js';

export const SERVICE_MODELS = ['research-agent', 'document-analyzer', 'data-extractor'] as const;

// $0.002 = 2000 per 1k input+output (split 1000/1000); $0.003 = 1500/1500
const SERVICE_PRICING: Record<string, ModelPricing> = {
  'research-agent': { inputPer1k: 1000n, outputPer1k: 1000n },
  'document-analyzer': { inputPer1k: 1500n, outputPer1k: 1500n },
  'data-extractor': { inputPer1k: 1000n, outputPer1k: 1000n },
};

export function getServiceModelPricing(model: string): ModelPricing | null {
  return SERVICE_PRICING[model] ?? null;
}

export function isServiceModel(model: string): boolean {
  return SERVICE_MODELS.includes(model as (typeof SERVICE_MODELS)[number]);
}

export const SERVICE_METADATA = [
  {
    id: 'research',
    name: 'AI Research',
    description: 'AI-powered research queries',
    route: '/v1/research',
    method: 'POST' as const,
    inputSchema: { query: 'string' },
    outputSchema: {
      type: 'string',
      query: 'string',
      summary: 'string',
      key_points: 'string[]',
      sources: 'string[]',
      pricing: 'object',
    },
  },
  {
    id: 'document',
    name: 'Document Analysis',
    description: 'Analyzes PDF documents and extracts insights',
    route: '/v1/document',
    method: 'POST' as const,
    inputSchema: { file: 'binary (multipart/form-data)' },
    outputSchema: {
      type: 'string',
      summary: 'string',
      entities: 'string[]',
      important_points: 'string[]',
      pricing: 'object',
    },
  },
  {
    id: 'extract',
    name: 'Data Extraction',
    description: 'Extracts structured data from web pages (static and JS-rendered)',
    route: '/v1/extract',
    method: 'POST' as const,
    inputSchema: { url: 'string (https URL)' },
    outputSchema: {
      type: 'string',
      url: 'string',
      extraction_method: 'static | dynamic',
      extracted_text_length: 'number',
      structured_data: 'object',
      pricing: 'object',
    },
  },
] as const;
