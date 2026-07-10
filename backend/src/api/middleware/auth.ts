import { AuthService } from '@config/auth.js';
import type { Request, Response, NextFunction } from 'express';

export interface AuthRequest extends Request {
  auth?: { token: string };
}

export function authMiddleware(auth: AuthService) {
  return (req: any, res: any, next: any) => {
    // If no password configured, allow all
    if (!auth.hasPassword) return next();

    // Check Authorization header
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.cookies?.session_token || '';

    if (auth.validateToken(token)) {
      return next();
    }

    // Allow public endpoints (no auth needed)
    const publicPaths = ['/api/health', '/api/spreads', '/api/pairs', '/api/history', '/api/trades', '/api/signals', '/api/ws-health', '/api/auth', '/api/mode', '/api/backtest'];
    if (publicPaths.some((p: string) => req.path.startsWith(p))) {
      return next();
    }

    res.status(401).json({ error: 'Unauthorized. Login required for this action.' });
  };
}

export function createAuthMiddleware(auth: AuthService) {
  return authMiddleware(auth);
}