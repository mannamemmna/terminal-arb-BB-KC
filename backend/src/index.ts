import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Router, type Request, type Response } from 'express';
import { config } from './config/index.js';
import { AuthService } from './config/auth.js';
import { BybitConnector } from './connectors/bybit.connector.js';
import { KucoinConnector } from './connectors/kucoin.connector.js';
import { BybitTrader } from './connectors/bybit.trader.js';
import { KucoinTrader } from './connectors/kucoin.trader.js';
import type { ConnectionStatus } from './connectors/types.js';
import { SpreadCalculator } from './engine/spreadCalculator.js';
import { PairDiscovery } from './engine/pairDiscovery.js';
import { WsServer } from './ws/server.js';
import { createBybitPool, createKucoinPool } from './ws/connectionPool.js';
import { PositionManager } from './engine/positionManager.js';
import { ExecutionOrchestrator } from './engine/executionOrchestrator.js';
import { PositionMonitor } from './engine/positionMonitor.js';
import { KillSwitch } from './engine/killSwitch.js';
import { createPairsRouter } from './api/routes/pairs.js';
import { createSpreadsRouter } from './api/routes/spreads.js';
import { createHistoryRouter } from './api/routes/history.js';
import { createTradesRouter } from './api/routes/trades.js';
import { createConfigRouter } from './api/routes/config.js';
import { createHealthRouter } from './api/routes/health.js';
import { createKillSwitchRouter } from './api/routes/killSwitch.js';
import { createAccountRouter } from './api/routes/account.js';
import { createOrdersRouter } from './api/routes/orders.js';
import { createPositionsRouter } from './api/routes/positions.js';
import { createBacktestRouter } from './api/routes/backtest.js';
import { createAuthRouter } from './api/routes/auth.js';
import { createWsHealthRouter } from './api/routes/wsHealth.js';
import prisma from './db/client.js';

// ---- Mode management (3 modes) ----
let currentMode: 'paper' | 'testnet' | 'live' = 'paper';
let bybitTrader: BybitTrader;
let kucoinTrader: KucoinTrader;
let positionManager: PositionManager;
let orchestrator: ExecutionOrchestrator;
let monitor: PositionMonitor;

function getMode() { return currentMode; }
function setMode(mode: string, confirm?: string) {
  if (!['paper', 'testnet', 'live'].includes(mode)) {
    return { ok: false, error: 'Mode must be paper, testnet, or live' };
  }
  if (mode === 'live') {
    if (!confirm || confirm !== 'CONFIRM LIVE') {
      return { ok: false, error: 'Must send confirm="CONFIRM LIVE" to switch to LIVE mode' };
    }
  }
  currentMode = mode as 'paper' | 'testnet' | 'live';
  // Reconfigure traders (or recreate for PaperTrader compatibility)
  if (bybitTrader && 'reconfigure' in bybitTrader) {
    (bybitTrader as any).reconfigure(currentMode);
    (kucoinTrader as any).reconfigure(currentMode);
  }
  return { ok: true };
}

// ---- PnL helper ----
function calcPnL(entryPriceA: number, exitPriceA: number, sideA: string,
                 entryPriceB: number, exitPriceB: number, sideB: string,
                 size: number): number {
  const multA = sideA === 'LONG' ? 1 : -1;
  const multB = sideB === 'LONG' ? 1 : -1;
  const pnlA = (exitPriceA - entryPriceA) * size * multA;
  const pnlB = (exitPriceB - entryPriceB) * size * multB;
  return +(pnlA + pnlB).toFixed(2);
}

// ---- Signal helper ----
function logStructuredSignal(symbol: string, verdict: string, spreadPct: number, fundingDiff: number, message: string, wsServer: WsServer | null) {
  console.log(`[SIGNAL] ${message}`);
  if (wsServer) wsServer.send({ type: 'signal:log', data: { timestamp: new Date(), message } });
  prisma.signal.create({
    data: { symbol, message, verdict, spreadPct, fundingDiff },
  }).catch(() => {});
}

async function main() {
  console.log('=== SPREAD ARB BACKEND v5 — CRITICAL BUG FIXES ===');

  await prisma.$connect();
  console.log('[DB] SQLite connected');

  // Auth
  const auth = new AuthService(process.env.SETTINGS_PASSWORD || '');
  if (auth.hasPassword) console.log('[Auth] Password protection enabled');

  // Engine
  const calculator = new SpreadCalculator();

  // ===== Connection Pools =====
  const bybitPool = createBybitPool();
  const kucoinPool = createKucoinPool();
  const symToStandard = new Map<string, string>();

  bybitPool.onTickerCb((symbol, price, funding, volume) => {
    const std = symToStandard.get(symbol) || symbol;
    calculator.setBybit(std, price, funding, volume);
  });

  const kucoinFundingCache = new Map<string, number>();
  kucoinPool.onTickerCb((symbol, price, funding, volume) => {
    let std = symToStandard.get(symbol);
    if (!std) {
      const base = symbol.replace('USDTM', '');
      std = calculator.keys().find(k => k.includes(base)) || symbol;
    }
    if (funding !== 0) kucoinFundingCache.set(std, funding);
    calculator.setKucoin(std, price, kucoinFundingCache.get(std) || funding, volume);
  });

  let bybitStatus: ConnectionStatus = 'connecting';
  let kucoinStatus: ConnectionStatus = 'connecting';
  bybitPool.onStatusCb((_ex, overall) => { bybitStatus = overall === 'live' ? 'live' : 'degraded'; });
  kucoinPool.onStatusCb((_ex, overall) => { kucoinStatus = overall === 'live' ? 'live' : 'degraded'; });

  // ===== Pair Discovery =====
  const discovery = new PairDiscovery();
  const addSymbolMappings = (s: string) => {
    symToStandard.set(s, s);
    symToStandard.set(s.toLowerCase(), s);
    symToStandard.set(s.replace('USDT', ''), s);
    symToStandard.set(s === 'BTCUSDT' ? 'XBTUSDTM' : s.replace('USDT', 'USDTM'), s);
  };
  const kucoinName = (s: string) => s === 'BTCUSDT' ? 'XBTUSDTM' : s.replace('USDT', 'USDTM');

  // wsServer placeholder for discovery signals
  let wsServerRef: WsServer | null = null;
  discovery.onSymbolsChange((newPairs, removedPairs) => {
    if (newPairs.length > 0) {
      logStructuredSignal('DISCOVERY', 'INFO', 0, 0, `[DISCOVERY] New pairs: ${newPairs.join(', ')}`, wsServerRef);
      for (const s of newPairs) addSymbolMappings(s);
    }
    if (removedPairs.length > 0) {
      logStructuredSignal('DISCOVERY', 'INFO', 0, 0, `[DISCOVERY] Removed pairs: ${removedPairs.join(', ')}`, wsServerRef);
    }
  });

  const allSymbols: string[] = [];
  discovery.start().then(() => {
    allSymbols.push(...discovery.symbols);
    console.log(`[DISCOVERY] ${allSymbols.length} matched pairs`);
    for (const s of allSymbols) addSymbolMappings(s);
    bybitPool.init(allSymbols).catch(() => {});
    kucoinPool.init(allSymbols.map(kucoinName)).catch(() => {});

    // One-time KuCoin REST seed for initial data
    setTimeout(async () => {
      try {
        const res = await fetch('https://api-futures.kucoin.com/api/v1/contracts/active');
        const json = await res.json() as any;
        if (json.code !== '200000' || !json.data) return;
        for (const item of json.data) {
          if (!item.symbol.endsWith('USDTM') || item.status !== 'Open') continue;
          const std = symToStandard.get(item.symbol);
          if (!std) continue;
          const price = parseFloat(item.markPrice) || 0;
          if (price > 0) calculator.setKucoin(std, price, parseFloat(item.fundingFeeRate) || 0, parseFloat(item.volumeOf24h) || 0);
        }
        console.log(`[SEED] KuCoin initial: ${json.data.length} pairs`);
      } catch {}
    }, 5000);
  }).catch(() => {});

  // ===== Legacy connectors (minimal REST fallback, will be deprecated) =====
  const bybitConn = new BybitConnector();
  const kucoinConn = new KucoinConnector();
  bybitConn.onTicker((data) => calculator.setBybit(data.symbol, data.markPrice, data.fundingRate, data.volume24h));
  kucoinConn.onTicker((data) => calculator.setKucoin(data.symbol, data.markPrice, data.fundingRate, data.volume24h));
  bybitConn.startRestPolling();
  kucoinConn.startRestPolling();

  // ===== Phase 3+5 modules =====
  bybitTrader = new BybitTrader('paper');
  kucoinTrader = new KucoinTrader('paper');
  positionManager = new PositionManager(bybitTrader, kucoinTrader);

  const logFn = (msg: string) => console.log(`[LOG] ${msg}`);
  const killSwitch = new KillSwitch(logFn);
  orchestrator = new ExecutionOrchestrator(bybitTrader, kucoinTrader, positionManager, calculator, logFn);
  monitor = new PositionMonitor(orchestrator, calculator, logFn);

  // Patch orchestrator closePos to use proper PnL
  const originalClose = orchestrator.closePosition.bind(orchestrator);
  orchestrator.closePosition = async (positionId: string) => {
    const pos = await prisma.position.findUnique({ where: { id: positionId } });
    if (!pos || pos.status !== 'OPEN') return false;
    const result = await originalClose(positionId);
    if (result) {
      // Update PnL with proper calculation
      const spread = calculator.compute(pos.symbol);
      const exitSpread = spread?.spreadPct || pos.entrySpread;
      const pnl = pos.size * (exitSpread - pos.entrySpread) * 10;
      await prisma.position.update({
        where: { id: positionId },
        data: { realizedPnl: +pnl.toFixed(2), status: 'CLOSED', closedAt: new Date() },
      });
    }
    return result;
  };

  killSwitch.setCloseAll(() => orchestrator.closeAllPositions());
  monitor.start(5000);

  calculator.onSignal((signal) => {
    const msg = signal.message;
    const parts = msg.split(' ');
    const symbol = parts[1]?.replace(':', '') || 'UNKNOWN';
    const verdict = msg.includes('[SIGNAL]') ? 'SAFE' : msg.includes('[WATCH]') ? 'WATCH' : 'INFO';
    logStructuredSignal(symbol, verdict, 0, 0, msg, wsServer);

    // Auto-entry in any mode except when kill-switch paused
    if (msg.includes('[SIGNAL]') && killSwitch.isActive) {
      const spread = calculator.computeAll().find(s => msg.includes(s.symbol));
      if (spread) {
        orchestrator.tryEnter(spread, currentMode).catch(() => {});
      }
    }
  });

  // ===== HTTP + WS =====
  const app = express();
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  const httpServer = createServer(app);
  const wsServer = new WsServer(httpServer);
  wsServerRef = wsServer;

  // Auth middleware
  app.use((req, res, next) => auth.middleware(req, res, next));

  // Broadcast
  setInterval(() => {
    const allSpreads = calculator.computeAll();
    const spreads = allSpreads.slice(0, 200);
    if (spreads.length > 0) {
      wsServer.broadcastSpreads(spreads);
      wsServer.broadcastStatus(bybitStatus, kucoinStatus);
    }
  }, 1000);
  calculator.onSpread((spread) => wsServer.broadcastSpread(spread));
  monitor.onUpdate((positions) => wsServer.send({ type: 'positions:update', data: positions }));

  // ===== Reset paper data at startup =====
  const resetOnStartup = (process.env.RESET_PAPER_DATA_ON_STARTUP || 'true') === 'true';
  if (resetOnStartup) {
    // Only delete non-live data
    const delPos = await prisma.position.deleteMany({ where: { mode: { not: 'live' } } });
    const delTrade = await prisma.trade.deleteMany({ where: { mode: { not: 'live' } } });
    const delOrder = await prisma.order.deleteMany({ where: { mode: { not: 'live' } } });
    // Reset paper account balances
    await prisma.paperAccount.deleteMany();
    await prisma.paperAccount.create({ data: { exchange: 'bybit', balance: 10000 } });
    await prisma.paperAccount.create({ data: { exchange: 'kucoin', balance: 10000 } });
    console.log(`[RESET] Cleared ${delPos.count} positions, ${delTrade.count} trades, ${delOrder.count} orders (non-live)`);
  }

  // ===== API routes =====
  app.use('/api/auth', createAuthRouter(auth));
  app.use('/api/pairs', createPairsRouter(calculator));
  app.use('/api/spreads', createSpreadsRouter(calculator));
  app.use('/api/history', createHistoryRouter());
  app.use('/api/trades', createTradesRouter());
  app.use('/api/ws-health', createWsHealthRouter(() => bybitPool.getHealth(), () => kucoinPool.getHealth()));
  
  app.use('/api/config', createConfigRouter(calculator));
  app.use('/api/mode', Router()
    .get('/', (_req: Request, res: Response) => res.json({ mode: currentMode }))
    .post('/', (req: Request, res: Response) => {
      const { mode, confirm } = req.body || {};
      const result = setMode(mode, confirm);
      if (!result.ok) { res.status(400).json({ error: result.error }); return; }
      res.json({ mode: currentMode });
    }));
  app.use('/api/kill-switch', createKillSwitchRouter(killSwitch));
  app.use('/api/account', createAccountRouter(bybitTrader, kucoinTrader));
  app.use('/api/orders', createOrdersRouter());
  app.use('/api/positions', createPositionsRouter(orchestrator));
  app.use('/api/backtest', createBacktestRouter());

  // Health
  app.use('/api/health', (req: Request, res: Response, next: any) => {
    bybitConn.status = bybitStatus;
    kucoinConn.status = kucoinStatus;
    createHealthRouter(calculator, bybitConn, kucoinConn, wsServer)(req, res, next);
  });

  // Equity curve endpoint (BUG #3)
  app.use('/api/equity-curve', (req: Request, res: Response) => {
    const mode = (req.query.mode as string) || 'paper';
    res.json({ mode, curve: [] }); // Simplified — returns empty, will be enhanced
  });

  // Manual paper reset (BUG #3)
  app.use('/api/paper/reset', async (_req: Request, res: Response) => {
    await prisma.position.deleteMany({ where: { mode: { not: 'live' } } });
    await prisma.trade.deleteMany({ where: { mode: { not: 'live' } } });
    await prisma.order.deleteMany({ where: { mode: { not: 'live' } } });
    await prisma.paperAccount.deleteMany();
    await prisma.paperAccount.create({ data: { exchange: 'bybit', balance: 10000 } });
    await prisma.paperAccount.create({ data: { exchange: 'kucoin', balance: 10000 } });
    res.json({ ok: true, message: 'Paper data reset' });
  });

  // Production: serve frontend
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('../dist'));
    app.get('*', (_req, res) => res.sendFile('index.html', { root: '../dist' }));
  }

  httpServer.listen(config.port, () => {
    console.log(`[HTTP] :${config.port}`);
    console.log(`[WS]   ws://0.0.0.0:${config.port}/ws`);
    console.log(`[MODE] ${currentMode}`);
    console.log('=== READY ===');
  });

  const shutdown = async () => {
    console.log('\n[SHUTDOWN]');
    bybitPool.stop(); kucoinPool.stop(); discovery.stop();
    monitor.stop(); wsServer.close(); await prisma.$disconnect();
    httpServer.close(); process.exit(0);
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
