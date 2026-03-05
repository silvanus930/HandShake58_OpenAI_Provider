/**
 * Data Extraction Provider Route
 * POST /extract (requires X-DRAIN-Voucher)
 *
 * @openapi
 * /extract:
 *   post:
 *     summary: Web page extraction
 *     description: Extracts structured data from a URL. Supports static and JS-rendered pages. Requires X-DRAIN-Voucher.
 *     tags:
 *       - Services
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: URL to extract content from
 *     responses:
 *       200:
 *         description: Extraction result
 *       400:
 *         description: Invalid URL
 *       402:
 *         description: Payment required
 *       422:
 *         description: Content could not be extracted
 *       500:
 *         description: Service error
 */

import { Router, type Request, type Response } from 'express';
import { extractFromUrl } from '../services/extractionService.js';
import type { DrainService } from '../drain.js';

export function createExtractionRoute(drainService: DrainService) {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { url } = req.body ?? {};
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          error: { message: 'url (string) is required', code: 'invalid_request' },
        });
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        res.status(400).json({
          error: { message: 'Invalid url', code: 'invalid_request' },
        });
        return;
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        res.status(400).json({
          error: { message: 'Only http/https URLs are allowed', code: 'invalid_request' },
        });
        return;
      }

      const result = await extractFromUrl(parsed.href);

      if ('error' in result && result.error) {
        return res.status(422).json(result);
      }

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
        console.log(`[drain] extract drained ${cost} USDC`);
      }

      if (!res.getHeader('X-Provider-Speed')) res.setHeader('X-Provider-Speed', 'fast');
      res.json(result);
    } catch (err) {
      console.error('[extract]', err);
      const message = err instanceof Error ? err.message : 'Extraction failed';
      res.status(500).json({
        error: { message, code: 'extraction_error' },
      });
    }
  });

  return router;
}
