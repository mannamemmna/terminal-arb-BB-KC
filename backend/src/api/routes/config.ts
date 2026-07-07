import { Router, type Request, type Response } from 'express';
import type { SpreadCalculator } from '../../engine/spreadCalculator.js';

export function createConfigRouter(calculator: SpreadCalculator) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json({
      spreadThreshold: calculator.thresholds.spreadThreshold,
      minFundingDiff: calculator.thresholds.minFundingDiff,
    });
  });

  router.post('/', (req: Request, res: Response) => {
    const body = req.body || {};
    if (body.spreadThreshold !== undefined) {
      calculator.thresholds.spreadThreshold = body.spreadThreshold;
    }
    if (body.minFundingDiff !== undefined) {
      calculator.thresholds.minFundingDiff = body.minFundingDiff;
    }
    res.json({
      spreadThreshold: calculator.thresholds.spreadThreshold,
      minFundingDiff: calculator.thresholds.minFundingDiff,
    });
  });

  return router;
}
