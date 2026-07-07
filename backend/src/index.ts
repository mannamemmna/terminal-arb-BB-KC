import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { config } from './config/index.js';
import { AuthService } from './config/auth.js';
import { BybitConnector } from './connectors/bybit.connector.js';
import { KucoinConnector } from './connectors/kucoin.connector.js';
import { BybitTrader } from './connectors/bybit.trader.js';
import { PaperTrader } from './connectors/paper.trader.js';
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
import { createModeRouter } from './api/routes/mode.js';
import { createKillSwitchRouter } from './api/routes/killSwitch.js';
import { createAccountRouter } from './api/routes/account.js';
import { createOrdersRouter } from './api/routes/orders.js';
import { createPositionsRouter } from './api/routes/positions.js';
import { createAuthRouter } from './api/routes/auth.js';
import { createWsHealthRouter } from './api/routes/wsHealth.js';
import prisma from './db/client.js';

let currentMode: 'demo' | 'live' = 'demo';
function getMode() { return currentMode; }
function setMode(mode: 'demo' | 'live', confirm?: string) {
  if (mode === 'live') {
    if (!confirm || confirm !== 'CONFIRM LIVE') return { ok: false, error: 'Must send confirm="CONFIRM LIVE" to switch to LIVE mode' };
    currentMode = 'live';
  } else { currentMode = 'demo'; }
  return { ok: true };
}

async function main() {
  console.log('=== SPREAD ARB BACKEND v4 — HARDENING & SCALING ===');

  await prisma.$connect();
  console.log('[DB] SQLite connected');

  // Auth
  const auth = new AuthService(process.env.SETTINGS_PASSWORD || '');
  if (auth.hasPassword) console.log('[Auth] Password protection enabled');

  // Engine
  const calculator = new SpreadCalculator();

  // Log function
  const logFn = (msg: string) => {
    console.log(`[SIGNAL] ${msg}`);
    const symbol = msg.split(' ')[1]?.replace(':', '') || 'UNKNOWN';
    prisma.signal.create({ data: { symbol, message: msg, verdict: msg.includes('[SIGNAL]') ? 'SAFE' : 'WATCH', spreadPct: 0, fundingDiff: 0 } }).catch(() => {});
  };

  // ===== Phase 4: Connection Pool =====
  const bybitPool = createBybitPool();
  const kucoinPool = createKucoinPool();
  const symToStandard = new Map<string, string>();

  bybitPool.onTickerCb((symbol, price, funding, volume) => {
    const std = symToStandard.get(symbol) || symbol;
    calculator.setBybit(std, price, funding, volume);
  });

  // KuCoin funding rate cache — tickerV2 sends bestBidPrice (no funding info),
  // instrument topic sends fundingRate + markPrice. We need to merge them.
  const kucoinFundingCache = new Map<string, number>();
  kucoinPool.onTickerCb((symbol, price, funding, volume) => {
    let std = symToStandard.get(symbol);
    if (!std) {
      const base = symbol.replace('USDTM', '');
      std = calculator.keys().find(k => k.includes(base)) || symbol;
    }
    // Cache funding rate from instrument updates, merge with ticker prices
    if (funding !== 0) kucoinFundingCache.set(std, funding);
    const cachedFunding = kucoinFundingCache.get(std) || 0;
    calculator.setKucoin(std, price, cachedFunding, volume);
  });

  let bybitStatus: ConnectionStatus = 'connecting';
  let kucoinStatus: ConnectionStatus = 'connecting';
  bybitPool.onStatusCb((_ex, overall) => { bybitStatus = overall === 'live' ? 'live' : 'degraded'; });
  kucoinPool.onStatusCb((_ex, overall) => { kucoinStatus = overall === 'live' ? 'live' : 'degraded'; });

  // ===== Pair Discovery =====
  const discovery = new PairDiscovery();
  discovery.onSymbolsChange((newPairs, removedPairs) => {
    if (newPairs.length > 0) logFn(`[DISCOVERY] New pairs: ${newPairs.join(', ')}`);
    if (removedPairs.length > 0) logFn(`[DISCOVERY] Removed pairs: ${removedPairs.join(', ')}`);
    // Update pools with new symbols
    if (newPairs.length > 0) {
      for (const s of newPairs) addSymbolMappings(s);
      bybitPool.updateSymbols(allSymbols).catch(() => {});
      kucoinPool.updateSymbols(allSymbols.map(kucoinName)).catch(() => {});
    }
  });

  // Helper to build symToStandard for a standard pair name
  const addSymbolMappings = (s: string) => {
    symToStandard.set(s, s);
    symToStandard.set(s.toLowerCase(), s);
    symToStandard.set(s.replace('USDT', ''), s);
    // Bybit naming — most pairs keep standard name
    // KuCoin naming — adds suffix M (e.g. ETHUSDT → ETHUSDTM)
    // Special case: BTC → XBT on KuCoin
    const kucoinSym = s === 'BTCUSDT' ? 'XBTUSDTM' : s.replace('USDT', 'USDTM');
    symToStandard.set(kucoinSym, s);
  };

  const kucoinName = (s: string) => s === 'BTCUSDT' ? 'XBTUSDTM' : s.replace('USDT', 'USDTM');

  // Start discovery in background — don't block server startup
  const allSymbols: string[] = [];
  discovery.start().then(() => {
    allSymbols.push(...discovery.symbols);
    logFn(`[DISCOVERY] ${allSymbols.length} matched pairs`);
    for (const s of allSymbols) addSymbolMappings(s);
    // Init pools
    bybitPool.init(allSymbols).catch(() => {});
    kucoinPool.init(allSymbols.map(kucoinName)).catch(() => {});
    
    // One-time initial seed from KuCoin REST for mark price + funding rate
    // (WS instrument topic updates eventually, but seed gives immediate data)
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
          const funding = parseFloat(item.fundingFeeRate) || 0;
          if (price > 0) calculator.setKucoin(std, price, funding, parseFloat(item.volumeOf24h) || 0);
        }
        logFn(`[SEED] KuCoin initial data: ${json.data.length} pairs`);
      } catch {}
    }, 5000);
  }).catch(() => {});

  // ===== Legacy connectors (REST fallback) =====
  const bybitConn = new BybitConnector();
  const kucoinConn = new KucoinConnector();
  bybitConn.onTicker((data) => calculator.setBybit(data.symbol, data.markPrice, data.fundingRate, data.volume24h));
  kucoinConn.onTicker((data) => calculator.setKucoin(data.symbol, data.markPrice, data.fundingRate, data.volume24h));
  bybitConn.startRestPolling();
  kucoinConn.startRestPolling();



  // ===== Phase 3 modules =====
  const bybitTrader = new PaperTrader();
  const kucoinTrader = new PaperTrader();
  const positionManager = new PositionManager(bybitTrader, kucoinTrader);
  const killSwitch = new KillSwitch(logFn);
  const orchestrator = new ExecutionOrchestrator(bybitTrader, kucoinTrader, positionManager, calculator, logFn);
  const monitor = new PositionMonitor(orchestrator, calculator, logFn);

  killSwitch.setCloseAll(() => orchestrator.closeAllPositions());
  monitor.start(5000);

  calculator.onSignal((signal) => {
    logFn(signal.message);
    if (signal.message.includes('[SIGNAL]') && killSwitch.isActive && currentMode !== 'live') {
      const spread = calculator.computeAll().find(s => signal.message.includes(s.symbol));
      if (spread) orchestrator.tryEnter(spread, currentMode).catch(() => {});
    }
  });

  // ===== HTTP + WS Server =====
  const app = express();
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  const httpServer = createServer(app);
  const wsServer = new WsServer(httpServer);

  // Auth middleware (protects POST/PUT/DELETE + sensitive endpoints)
  app.use((req, res, next) => auth.middleware(req, res, next));

  // Broadcast loop
  setInterval(() => {
    const allSpreads = calculator.computeAll();
    const spreads = allSpreads.slice(0, 200); // max 200 rows to frontend
    if (spreads.length > 0) {
      wsServer.broadcastSpreads(spreads);
      wsServer.broadcastStatus(bybitStatus, kucoinStatus);
    }
  }, 1000);
  calculator.onSpread((spread) => wsServer.broadcastSpread(spread));
  monitor.onUpdate((positions) => wsServer.send({ type: 'positions:update', data: positions }));

  // API routes — public read-only
  app.use('/api/auth', createAuthRouter(auth));
  app.use('/api/pairs', createPairsRouter(calculator));
  app.use('/api/spreads', createSpreadsRouter(calculator));
  app.use('/api/history', createHistoryRouter());
  app.use('/api/trades', createTradesRouter());
  // Use the ConnectionPoolManager instances for health — they track actual WS status
  const healthBybit = { status: bybitStatus };
  const healthKucoin = { status: kucoinStatus };
  app.use('/api/health', (req, res, next) => {
    // Override status to use pool status
    const router = createHealthRouter(calculator, bybitConn, kucoinConn, wsServer);
    // Patch: health router reads .status from connector objects
    bybitConn.status = bybitStatus;
    kucoinConn.status = kucoinStatus;
    router(req, res, next);
  });
  app.use('/api/ws-health', createWsHealthRouter(() => bybitPool.getHealth(), () => kucoinPool.getHealth()));

  // API routes — protected by auth middleware
  app.use('/api/config', createConfigRouter(calculator));
  app.use('/api/mode', createModeRouter(getMode, setMode));
  app.use('/api/kill-switch', createKillSwitchRouter(killSwitch));
  app.use('/api/account', createAccountRouter(bybitTrader, kucoinTrader));
  app.use('/api/orders', createOrdersRouter());
  app.use('/api/positions', createPositionsRouter(orchestrator));

  // Serve frontend
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('../dist'));
    app.get('*', (_req, res) => res.sendFile('index.html', { root: '../dist' }));
  }

  httpServer.listen(config.port, () => {
    console.log(`[HTTP] :${config.port}`);
    console.log(`[WS]   ws://0.0.0.0:${config.port}/ws`);
    console.log(`[MODE] ${currentMode}`);
    console.log('[WS-HEALTH] /api/ws-health');
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
