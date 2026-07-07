import { Router, type Request, type Response } from 'express';
import type { BybitTrader } from '../../connectors/bybit.trader.js';
import type { KucoinTrader } from '../../connectors/kucoin.trader.js';

export function createAccountRouter(bybit: BybitTrader, kucoin: KucoinTrader) {
  const router = Router();

  router.get('/:exchange', async (req: Request, res: Response) => {
    const exchange = (req.params.exchange as string).toLowerCase();
    try {
      if (exchange === 'bybit') {
        const balance = await bybit.getBalance();
        const positions = await bybit.getOpenPositions();
        res.json({ exchange: 'bybit', balance, positions });
      } else if (exchange === 'kucoin') {
        const balance = await kucoin.getBalance();
        const positions = await kucoin.getOpenPositions();
        res.json({ exchange: 'kucoin', balance, positions });
      } else {
        res.status(400).json({ error: 'Exchange must be "bybit" or "kucoin"' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
