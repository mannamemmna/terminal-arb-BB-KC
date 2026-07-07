import { Router, type Request, type Response } from 'express';
import prisma from '../../db/client.js';

export function createHistoryRouter() {
  const router = Router();

  router.get('/:symbol', async (req: Request, res: Response) => {
    const symbol = (req.params.symbol as string).toUpperCase();
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    const signals = await prisma.signal.findMany({
      where: { symbol },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ symbol, signals, count: signals.length });
  });

  return router;
}
