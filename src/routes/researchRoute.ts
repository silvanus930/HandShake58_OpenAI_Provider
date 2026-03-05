/**
 * Research Provider Route
 * POST /research (requires X-DRAIN-Voucher)
 *
 * @openapi
 * /research:
 *   post:
 *     summary: AI research query
 *     description: Runs a research prompt using OpenAI models. Requires X-DRAIN-Voucher header.
 *     tags:
 *       - Services
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: Research query
 *     responses:
 *       200:
 *         description: Research result
 *       400:
 *         description: Invalid request
 *       402:
 *         description: Payment required (voucher missing or invalid)
 *       500:
 *         description: Service error
 */

import { Router, type Request, type Response } from 'express';
import { runResearch } from '../services/researchService.js';
import type { DrainService } from '../drain.js';

export function createResearchRoute(drainService: DrainService) {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { query } = req.body ?? {};
      if (!query || typeof query !== 'string') {
        res.status(400).json({
          error: { message: 'query (string) is required', code: 'invalid_request' },
        });
        return;
      }

      const result = await runResearch(query);

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
        console.log(`[drain] research drained ${cost} USDC`);
      }

      if (!res.getHeader('X-Provider-Speed')) res.setHeader('X-Provider-Speed', 'fast');
      res.json(result);
    } catch (err) {
      console.error('[research]', err);
      const message = err instanceof Error ? err.message : 'Research failed';
      res.status(500).json({
        error: { message, code: 'research_error' },
      });
    }
  });

  return router;
}
