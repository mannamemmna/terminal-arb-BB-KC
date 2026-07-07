import { Router, type Request, type Response } from 'express';
import type { SpreadCalculator } from '../../engine/spreadCalculator.js';

export function createPairsRouter(calculator: SpreadCalculator) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const symbols = calculator.keys();
    const pairs = symbols.map(sym => {
      const snap = calculator.get(sym);
      return {
        symbol: sym,
        bybitAvailable: snap?.bybitPrice !== null,
        kucoinAvailable: snap?.kucoinPrice !== null,
        currentSpread: snap && snap.bybitPrice && snap.kucoinPrice
          ? +(Math.abs(snap.bybitPrice - snap.kucoinPrice) / ((snap.bybitPrice + snap.kucoinPrice) / 2) * 100).toFixed(4)
          : null,
      };
    });
    res.json({ pairs });
  });

  return router;
}
