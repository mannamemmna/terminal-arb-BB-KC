/**
 * Mock data generators for Phase 1 UI simulation.
 * All data is randomized within realistic ranges for perpetual futures.
 * Replace with real WebSocket feeds in Phase 2.
 */

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'POLUSDT',
  'ATOMUSDT', 'UNIUSDT', 'BCHUSDT', 'LTCUSDT', 'NEARUSDT',
  'APTUSDT', 'ARBUSDT', 'OPUSDT', 'FILUSDT', 'INJUSDT',
];

// Base prices (roughly current market) for realistic price generation
const BASE_PRICES = {
  BTCUSDT: 68500, ETHUSDT: 3450, SOLUSDT: 145, XRPUSDT: 0.62,
  DOGEUSDT: 0.125, ADAUSDT: 0.45, AVAXUSDT: 35, LINKUSDT: 14.5,
  DOTUSDT: 7.2, POLUSDT: 0.52, ATOMUSDT: 8.5, UNIUSDT: 7.8,
  BCHUSDT: 380, LTCUSDT: 72, NEARUSDT: 5.2, APTUSDT: 8.9,
  ARBUSDT: 1.05, OPUSDT: 2.4, FILUSDT: 5.8, INJUSDT: 25,
};

let seed = 1;
function seededRandom() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

function randomInRange(base, pct) {
  const r = (seededRandom() - 0.5) * 2 * pct;
  return base * (1 + r);
}

function roundToTick(price, tick = 0.01) {
  return Math.round(price / tick) * tick;
}

export function generateSpreadEntry(symbol) {
  const base = BASE_PRICES[symbol] || 50;

  // Bybit and KuCoin prices differ slightly (the spread)
  const bybitPrice = roundToTick(randomInRange(base, 0.002)); // ±0.2%
  const kucoinPrice = roundToTick(randomInRange(base, 0.002));

  const spreadPrice = Math.abs(bybitPrice - kucoinPrice);
  const midPrice = (bybitPrice + kucoinPrice) / 2;
  const spreadPct = (spreadPrice / midPrice) * 100;

  const fundBybit = randomInRange(0.015, 0.6); // 0.006% - 2.4%
  const fundKucoin = randomInRange(0.012, 0.6);
  const fundDiff = fundBybit - fundKucoin;

  const volume = Math.round(randomInRange(100_000_000, 0.8));

  let verdict;
  if (spreadPct > 0.5 && Math.abs(fundDiff) > 0.01) verdict = 'SAFE';
  else if (spreadPct > 0.2) verdict = 'WATCH';
  else verdict = 'SKIP';

  return {
    symbol,
    bybitPrice,
    kucoinPrice,
    spreadPct: +spreadPct.toFixed(4),
    spreadPrice: +spreadPrice.toFixed(2),
    fundingBybit: +fundBybit.toFixed(4),
    fundingKucoin: +fundKucoin.toFixed(4),
    fundingDiff: +fundDiff.toFixed(4),
    volume24h: volume,
    verdict,
  };
}

export function generateAllSpreads() {
  seed = Date.now() % 2147483647;
  return SYMBOLS.map(generateSpreadEntry)
    .sort((a, b) => b.spreadPct - a.spreadPct);
}

export function generatePnLEntry(index) {
  // Simulate a gradually climbing equity curve with small retracements
  const base = index * 12.5 + (seededRandom() - 0.5) * 30;
  const pnl = +base.toFixed(2);
  const pnlPct = +(pnl / 10000 * 100).toFixed(2);
  return {
    time: Date.now() - (99 - index) * 60000, // 1 min intervals
    pnl,
    pnlPct,
  };
}

export function generateEquityCurve() {
  return Array.from({ length: 100 }, (_, i) => generatePnLEntry(i));
}

export function generatePosition() {
  const symbol = SYMBOLS[Math.floor(seededRandom() * SYMBOLS.length)];
  const base = BASE_PRICES[symbol] || 50;
  const entrySpread = +(seededRandom() * 0.8 + 0.2).toFixed(4);
  const currentSpread = +(entrySpread + (seededRandom() - 0.5) * 0.2).toFixed(4);
  const isProfitable = currentSpread > entrySpread;
  const pnl = +((currentSpread - entrySpread) * 50).toFixed(2);
  const holdMinutes = Math.floor(seededRandom() * 720);
  const side = seededRandom() > 0.5 ? 'LONG' : 'SHORT';

  return {
    symbol,
    sideBybit: side === 'LONG' ? 'LONG' : 'SHORT',
    sideKucoin: side === 'LONG' ? 'SHORT' : 'LONG',
    entrySpread,
    currentSpread,
    pnl,
    pnlPct: +(pnl / 500 * 100).toFixed(2),
    holdTime: `${Math.floor(holdMinutes / 60)}h ${holdMinutes % 60}m`,
    sl: +(entrySpread * 0.5).toFixed(4),
    tp: +(entrySpread * 2.0).toFixed(4),
  };
}

export function generateActivePositions(count = 3) {
  return Array.from({ length: count }, generatePosition);
}

export function generateLogEntry(index) {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'AVAXUSDT'];
  const sym = symbols[Math.floor(seededRandom() * symbols.length)];
  const spread = +(seededRandom() * 0.8 + 0.1).toFixed(2);
  const fundDiff = +((seededRandom() - 0.5) * 0.06).toFixed(4);
  const actions = [
    `Detected ${spread}% spread on ${sym} (Bybit vs KuCoin)`,
    `Spread widened to ${(spread + 0.1).toFixed(2)}% — ${sym} entering watch zone`,
    `${sym}: Funding diff ${fundDiff}% — direction bias ${fundDiff > 0 ? 'LONG Bybit / SHORT KuCoin' : 'SHORT Bybit / LONG KuCoin'}`,
    `${sym} spread ${spread}% > threshold — signal GENERATED`,
    `${sym} spread narrowed to ${(spread - 0.15).toFixed(2)}% — removed from watchlist`,
    `Position opened: ${sym} | Entry spread ${spread}% | Size 0.5x`,
    `${sym} funding payment imminent — adjusting position`,
    `${sym} PnL: +$${(spread * 30).toFixed(2)} (${+(spread * 5).toFixed(2)}%)`,
    `Order executed: ${sym} market buy @ ${(BASE_PRICES[sym] || 50) + (seededRandom() - 0.5) * 10}`,
    `Health check: ${sym} legs both active — hedge OK`,
  ];
  return {
    id: `log-${Date.now()}-${index}`,
    time: new Date(Date.now() - (500 - index) * 1000),
    message: actions[index % actions.length],
  };
}

export function generateInitialLogs(count = 100) {
  return Array.from({ length: count }, (_, i) => generateLogEntry(i));
}

export function generateTradeEntry(index) {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'LINKUSDT'];
  const sym = symbols[Math.floor(seededRandom() * symbols.length)];
  const entrySpread = +(seededRandom() * 0.6 + 0.15).toFixed(4);
  const exitSpread = +(entrySpread + (seededRandom() - 0.5) * 0.3).toFixed(4);
  const pnl = +((exitSpread - entrySpread) * 50).toFixed(2);
  const now = Date.now();

  return {
    id: `trade-${index}`,
    time: new Date(now - index * 1800000),
    symbol: sym,
    entrySpread,
    exitSpread,
    pnl,
    pnlPct: +(pnl / 500 * 100).toFixed(2),
    status: seededRandom() > 0.15 ? 'CLOSED' : 'OPEN',
  };
}

export function generateTradeHistory(count = 25) {
  return Array.from({ length: count }, (_, i) => generateTradeEntry(i))
    .sort((a, b) => b.time - a.time);
}
