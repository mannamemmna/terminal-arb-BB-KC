import { Router, type Request, type Response } from 'express';
import type { ExecutionOrchestrator } from '../../engine/executionOrchestrator.js';
import prisma from '../../db/client.js';

export function createPositionsRouter(orchestrator: ExecutionOrchestrator) {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    const positions = await prisma.position.findMany({ orderBy: { openedAt: 'desc' } });
    res.json({ positions, count: positions.length });
  });

  router.get('/open', async (_req: Request, res: Response) => {
    const positions = await prisma.position.findMany({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
    res.json({ positions, count: positions.length });
  });

  router.post('/:id/close', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      const ok = await orchestrator.closePosition(id);
      if (ok) res.json({ success: true, message: 'Position closed' });
      else res.status(404).json({ error: 'Position not found or already closed' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
