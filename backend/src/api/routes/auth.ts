import { Router, type Request, type Response } from 'express';
import type { AuthService } from '../../config/auth.js';

export function createAuthRouter(auth: AuthService) {
  const router = Router();

  // GET /api/auth/status — check if auth is configured & current session status
  router.get('/status', (req: Request, res: Response) => {
    const token = (req.headers.authorization || '').startsWith('Bearer ')
      ? req.headers.authorization.slice(7) : (req as any).cookies?.session_token || '';
    const authenticated = auth.validateToken(token);
    res.json({
      hasPassword: auth.hasPassword,
      authenticated,
    });
  });

  // POST /api/auth/login — authenticate
  router.post('/login', (req: Request, res: Response) => {
    const { password } = req.body || {};
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    if (!password) {
      res.status(400).json({ error: 'Password required' });
      return;
    }

    const result = auth.login(ip, password);
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }

    // Set httpOnly cookie
    res.cookie('session_token', result.token, {
      httpOnly: true,
      secure: false, // set true if using HTTPS
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({ ok: true, token: result.token });
  });

  // POST /api/auth/logout
  router.post('/logout', (req: Request, res: Response) => {
    const token = (req.headers.authorization || '').startsWith('Bearer ')
      ? req.headers.authorization.slice(7) : (req as any).cookies?.session_token || '';
    if (token) auth.logout(token);
    res.clearCookie('session_token');
    res.json({ ok: true });
  });

  return router;
}
