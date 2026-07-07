import { Router, type Request, type Response } from 'express';

export function createModeRouter(
  getMode: () => 'demo' | 'live',
  setMode: (mode: 'demo' | 'live', confirm?: string) => { ok: boolean; error?: string },
) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json({ mode: getMode() });
  });

  router.post('/', (req: Request, res: Response) => {
    const { mode, confirm } = req.body || {};
    if (mode !== 'demo' && mode !== 'live') {
      res.status(400).json({ error: 'Mode must be "demo" or "live"' });
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
