import { Router, type Request, type Response } from 'express';
import prisma from '../../db/client.js';

export function createOrdersRouter() {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const positionId = req.query.positionId?.toString();

    const where: any = {};
    if (positionId) where.positionId = positionId;

    const orders = await prisma.order.findMany({
      where, orderBy: { createdAt: 'desc' }, take: limit,
    });
    res.json({ orders, count: orders.length });
  });

  return router;
}
