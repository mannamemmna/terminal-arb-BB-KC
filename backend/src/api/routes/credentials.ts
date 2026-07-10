import { Router, type Request, type Response } from 'express';
import { createAuthMiddleware, type AuthRequest } from '@middleware/auth.js';
import { encrypt, decrypt, maskCredential, validateEncryptionKey } from '@config/encryption.js';
import prisma from '@db/client.js';

export function createCredentialsRouter(authService: any) {
  const router = Router();

  // Middleware: require auth for all routes
  const authMiddleware = createAuthMiddleware(authService);
  router.use(authMiddleware);

  // Helper: extract param as string
  function getParam(val: string | string[] | undefined, fallback: string = ''): string {
    if (!val) return fallback;
    return Array.isArray(val) ? val[0] : val;
  }

  // GET /api/credentials - list all credential statuses (no secrets)
  router.get('/', async (_req: AuthRequest, res: Response) => {
    try {
      const creds = await (prisma as any).apiCredential.findMany({
        orderBy: [{ exchange: 'asc' }, { mode: 'asc' }],
      });

      const result = creds.map((c: any) => ({
        exchange: c.exchange,
        mode: c.mode,
        isValid: c.isValid,
        lastValidated: c.lastValidated,
        apiKeyPreview: c.apiKeyEnc ? maskCredential(decrypt(c.apiKeyEnc)) : null,
        apiSecretPreview: c.apiSecretEnc ? maskCredential(decrypt(c.apiSecretEnc)) : null,
        passphrasePreview: c.passphraseEnc ? maskCredential(decrypt(c.passphraseEnc)) : null,
      }));

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/credentials/:exchange/:mode - save/update credentials
  router.post('/:exchange/:mode', async (req: AuthRequest, res: Response) => {
    try {
      const exchange = getParam(req.params.exchange);
      const mode = getParam(req.params.mode);
      const { apiKey, apiSecret, passphrase } = req.body;

      if (!['bybit', 'kucoin'].includes(exchange)) {
        return res.status(400).json({ error: 'Invalid exchange. Must be bybit or kucoin' });
      }
      if (!['testnet', 'live'].includes(mode)) {
        return res.status(400).json({ error: 'Invalid mode. Must be testnet or live' });
      }
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ error: 'apiKey and apiSecret are required' });
      }
      if (exchange === 'kucoin' && !passphrase) {
        return res.status(400).json({ error: 'passphrase is required for KuCoin' });
      }

      // Validate encryption key
      if (!validateEncryptionKey()) {
        return res.status(500).json({ error: 'ENCRYPTION_KEY not configured in environment' });
      }

      // Encrypt credentials
      const apiKeyEnc = encrypt(apiKey);
      const apiSecretEnc = encrypt(apiSecret);
      const passphraseEnc = passphrase ? encrypt(passphrase) : null;

      // Upsert
      const cred = await (prisma as any).apiCredential.upsert({
        where: { exchange_mode: { exchange, mode } },
        update: { apiKeyEnc, apiSecretEnc, passphraseEnc, isValid: false, lastValidated: null },
        create: { exchange, mode, apiKeyEnc, apiSecretEnc, passphraseEnc, isValid: false },
      });

      res.json({
        exchange: cred.exchange,
        mode: cred.mode,
        isValid: cred.isValid,
        message: 'Credentials saved. Click Validate to test them.',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/credentials/:exchange/:mode/validate - test credentials
  router.post('/:exchange/:mode/validate', async (req: AuthRequest, res: Response) => {
    try {
      const exchange = getParam(req.params.exchange);
      const mode = getParam(req.params.mode);

      const cred = await (prisma as any).apiCredential.findUnique({
        where: { exchange_mode: { exchange, mode } },
      });

      if (!cred) {
        return res.status(404).json({ error: 'Credentials not found for this exchange/mode' });
      }

      // Decrypt
      const apiKey = decrypt(cred.apiKeyEnc);
      const apiSecret = decrypt(cred.apiSecretEnc);
      const passphrase = cred.passphraseEnc ? decrypt(cred.passphraseEnc) : undefined;

      // Test with a light API call (get balance)
      let isValid = false;
      let errorMessage = '';

      try {
        if (exchange === 'bybit') {
          const { BybitTrader } = await import('@connectors/bybit.trader.js');
          const trader = new BybitTrader(mode === 'testnet' ? 'testnet' : 'live');
          await trader.getBalance();
          isValid = true;
        } else {
          const { KucoinTrader } = await import('@connectors/kucoin.trader.js');
          const trader = new KucoinTrader(mode === 'testnet' ? 'testnet' : 'live');
          await trader.getBalance();
          isValid = true;
        }
      } catch (err: any) {
        errorMessage = err.message;
      }

      // Update validation status
      await (prisma as any).apiCredential.update({
        where: { id: cred.id },
        data: { isValid, lastValidated: isValid ? new Date() : null },
      });

      res.json({
        exchange,
        mode,
        isValid,
        lastValidated: isValid ? new Date().toISOString() : null,
        error: isValid ? null : errorMessage,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/credentials/:exchange/:mode - delete credentials
  router.delete('/:exchange/:mode', async (req: AuthRequest, res: Response) => {
    try {
      const exchange = getParam(req.params.exchange);
      const mode = getParam(req.params.mode);

      await (prisma as any).apiCredential.delete({
        where: { exchange_mode: { exchange, mode } },
      });

      res.json({ success: true, message: 'Credentials deleted' });
    } catch (err: any) {
      if (err.code === 'P2025') {
        return res.status(404).json({ error: 'Credentials not found' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}