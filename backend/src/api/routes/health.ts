import { Router, type Request, type Response } from 'express';
import type { SpreadCalculator } from '../../engine/spreadCalculator.js';
import type { BybitConnector } from '../../connectors/bybit.connector.js';
import type { KucoinConnector } from '../../connectors/kucoin.connector.js';
import type { WsServer } from '../../ws/server.js';

export function createHealthRouter(
  calculator: SpreadCalculator,
  bybit: BybitConnector,
  kucoin: KucoinConnector,
  wsServer: WsServer,
) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      bybit: bybit.status,
      kucoin: kucoin.status,
      wsClients: wsServer.clientCount,
      marketState: {
        totalSymbols: calculator.keys().length,
        staleSymbols: calculator.getStaleSymbols(),
        avgAge: calculator.avgAge,
      },
      timestamp: Date.now(),
    });
  });

  return router;
}
