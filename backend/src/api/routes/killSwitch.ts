import { Router, type Request, type Response } from 'express';
import type { KillSwitch } from '../../engine/killSwitch.js';

export function createKillSwitchRouter(killSwitch: KillSwitch) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json({ state: killSwitch.getState() });
  });

  router.post('/', (req: Request, res: Response) => {
    const { action } = req.body || {};
    if (action === 'pause') killSwitch.pause().then(() => res.json({ state: 'PAUSED' }));
    else if (action === 'resume') killSwitch.resume().then(() => res.json({ state: 'ACTIVE' }));
    else if (action === 'close-all') killSwitch.trigger().then(() => res.json({ state: 'TRIGGERED' }));
    else res.status(400).json({ error: 'Invalid action. Use: pause, resume, close-all' });
  });

  return router;
}
