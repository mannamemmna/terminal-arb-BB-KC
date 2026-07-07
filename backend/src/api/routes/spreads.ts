import { Router, type Request, type Response } from 'express';
import type { SpreadCalculator } from '../../engine/spreadCalculator.js';

export function createSpreadsRouter(calculator: SpreadCalculator) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const spreads = calculator.computeAll();
    res.json({ spreads, count: spreads.length, timestamp: Date.now() });
  });

  router.get('/:symbol', (req: Request, res: Response) => {
    const sym = (req.params.symbol as string).toUpperCase();
    const spread = calculator.compute(sym);
    const snap = calculator.get(sym);
    if (!spread && !snap) {
      res.status(404).json({ error: `Symbol ${sym} not found` });
      return;
    }
    res.json({ spread, snapshot: snap });
  });

  return router;
}
