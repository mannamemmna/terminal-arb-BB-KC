import * as crypto from 'node:crypto';

const SALT = 'spread-arb-term-salt';

function hashPassword(password: string): string {
  return crypto.createHmac('sha256', SALT).update(password).digest('hex');
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

interface Session {
  token: string;
  createdAt: number;
  expiresAt: number;
}

export class AuthService {
  private passwordHash: string;
  private sessions = new Map<string, Session>();
  private loginAttempts = new Map<string, { count: number; resetAt: number }>();
  private readonly MAX_ATTEMPTS = 5;
  private readonly RATE_WINDOW_MS = 15 * 60 * 1000; // 15 min
  private readonly SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

  constructor(password: string) {
    this.passwordHash = password ? hashPassword(password) : '';
  }

  get hasPassword(): boolean {
    return this.passwordHash !== '';
  }

  login(ip: string, password: string): { ok: boolean; token?: string; error?: string } {
    // Rate limit check
    const now = Date.now();
    const attempt = this.loginAttempts.get(ip) || { count: 0, resetAt: now + this.RATE_WINDOW_MS };

    if (attempt.resetAt < now) {
      attempt.count = 0;
      attempt.resetAt = now + this.RATE_WINDOW_MS;
    }
    attempt.count++;
    this.loginAttempts.set(ip, attempt);

    if (attempt.count > this.MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((attempt.resetAt - now) / 1000);
      return { ok: false, error: `Too many attempts. Retry in ${retryAfter}s` };
    }

    // Verify password
    if (hashPassword(password) !== this.passwordHash) {
      return { ok: false, error: 'Invalid password' };
    }

    // Create session
    const token = generateToken();
    this.sessions.set(token, {
      token,
      createdAt: now,
      expiresAt: now + this.SESSION_DURATION_MS,
    });

    // Clean expired sessions
    for (const [t, s] of this.sessions) {
      if (s.expiresAt < now) this.sessions.delete(t);
    }

    return { ok: true, token };
  }

  validateToken(token: string): boolean {
    const session = this.sessions.get(token);
    if (!session) return false;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }

  /** Express middleware — validates Bearer token or signed cookie */
  middleware(req: any, res: any, next: any): void {
    // If no password configured, allow all
    if (!this.hasPassword) return next();

    // Check Authorization header
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.cookies?.session_token || '';

    if (this.validateToken(token)) {
      return next();
    }

    // Allow public endpoints (no auth needed)
    const publicPaths = ['/api/health', '/api/spreads', '/api/pairs', '/api/history', '/api/trades', '/api/signals', '/api/ws-health', '/api/auth', '/api/mode'];
    if (publicPaths.some((p: string) => req.path.startsWith(p))) {
      return next();
    }

    res.status(401).json({ error: 'Unauthorized. Login required for this action.' });
  }
}
