/**
 * Document Analysis Provider Route
 * POST /document (multipart/form-data, requires X-DRAIN-Voucher)
 *
 * @openapi
 * /document:
 *   post:
 *     summary: Document analysis
 *     description: Analyzes PDF document and extracts insights. Requires X-DRAIN-Voucher. Send as multipart/form-data.
 *     tags:
 *       - Services
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: PDF file
 *     responses:
 *       200:
 *         description: Document analysis result
 *       400:
 *         description: Invalid request (PDF required)
 *       402:
 *         description: Payment required
 *       500:
 *         description: Service error
 */

import { Router, type Request, type Response } from 'express';
import { analyzeDocument } from '../services/documentService.js';
import type { DrainService } from '../drain.js';

export function createDocumentRoute(drainService: DrainService) {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file || !file.buffer) {
        res.status(400).json({
          error: {
            message: 'PDF file is required (multipart/form-data field: file)',
            code: 'invalid_request',
          },
        });
        return;
      }

      const result = await analyzeDocument(file.buffer);

      if (req.drainVoucher && req.drainChannelState) {
        const price = result.pricing?.price ?? 0;
        const cost = BigInt(Math.ceil(price * 1_000_000));
        drainService.storeVoucher(req.drainVoucher, req.drainChannelState, cost);
        const total = req.drainChannelState.totalCharged + cost;
        const remaining = req.drainChannelState.deposit - total;
        res.set({
          'X-DRAIN-Cost': cost.toString(),
          'X-DRAIN-Total': total.toString(),
          'X-DRAIN-Remaining': remaining.toString(),
          'X-Provider-Speed': 'fast',
        });
        console.log(`[drain] document drained ${cost} USDC`);
      }

      if (!res.getHeader('X-Provider-Speed')) res.setHeader('X-Provider-Speed', 'fast');
      res.json(result);
    } catch (err) {
      console.error('[document]', err);
      const message = err instanceof Error ? err.message : 'Document analysis failed';
      res.status(500).json({
        error: { message, code: 'document_error' },
      });
    }
  });

  return router;
}
