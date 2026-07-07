import { Router, type Request, type Response } from 'express';
import prisma from '../../db/client.js';

export function createTradesRouter() {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const status = req.query.status?.toString();

    const where: any = {};
    if (status) where.status = status.toUpperCase();

    const trades = await prisma.trade.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ trades, count: trades.length });
  });

  return router;
}
