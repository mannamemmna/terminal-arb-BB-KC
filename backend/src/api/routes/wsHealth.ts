import { Router, type Request, type Response } from 'express';

export function createWsHealthRouter(getBybitHealth: () => any[], getKucoinHealth: () => any[]) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const bybit = getBybitHealth();
    const kucoin = getKucoinHealth();
    const bybitOk = bybit.filter(s => s.status === 'live').length;
    const kucoinOk = kucoin.filter(s => s.status === 'live').length;

    res.json({
      bybit: { shards: bybit, healthy: `${bybitOk}/${bybit.length}` },
      kucoin: { shards: kucoin, healthy: `${kucoinOk}/${kucoin.length}` },
      timestamp: Date.now(),
    });
  });

  return router;
}
