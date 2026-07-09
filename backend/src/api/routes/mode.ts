import { Router, type Request, type Response } from 'express';

export function createModeRouter(
  getMode: () => 'paper' | 'testnet' | 'live',
  setMode: (mode: string, confirm?: string) => { ok: boolean; error?: string },
) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json({ mode: getMode() });
  });

  router.post('/', (req: Request, res: Response) => {
    const { mode, confirm } = req.body || {};
    if (!['paper', 'testnet', 'live'].includes(mode)) {
      res.status(400).json({ error: 'Mode must be "paper", "testnet", or "live"' });
      return;
    }
    const result = setMode(mode, confirm);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ mode: getMode() });
  });

  return router;
}