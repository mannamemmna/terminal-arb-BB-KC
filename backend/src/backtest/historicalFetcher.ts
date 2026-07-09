import { config } from '../config/index.js';
import { getByBybit, getByKucoin } from '../engine/symbolMapper.js';
import prisma from '../db/client.js';

interface CandleInput {
  exchange: 'bybit' | 'kucoin';
  symbol: string;
  interval: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FundingInput {
  exchange: 'bybit' | 'kucoin';
  symbol: string;
  timestamp: Date;
  fundingRate: number;
}

class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  async take(tokens = 1): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= tokens) {
        this.tokens -= tokens;
        return;
      }
      const waitMs = Math.ceil((tokens - this.tokens) / this.refillRate * 1000);
      await new Promise(r => setTimeout(r, Math.max(waitMs, 10)));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsedSec * this.refillRate);
    this.lastRefill = now;
  }
}

const bybitLimiter = new RateLimiter(10, 10);
const kucoinLimiter = new RateLimiter(10, 10);

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchBybitKlines(symbol: string, interval: string, start: number, end: number): Promise<any[]> {
  await bybitLimiter.take();
  const params = new URLSearchParams({
    category: 'linear',
    symbol,
    interval,
    start: start.toString(),
    end: end.toString(),
    limit: '200',
  });
  const url = `${config.bybit.restUrl}/v5/market/kline?${params}`;
  const res = await fetch(url);
  const json = await res.json() as any;
  if (json.retCode !== 0) throw new Error(`Bybit kline error: ${json.retMsg}`);
  return json.result.list.map((item: any) => ({
    timestamp: new Date(parseInt(item[0])),
    open: parseFloat(item[1]),
    high: parseFloat(item[2]),
    low: parseFloat(item[3]),
    close: parseFloat(item[4]),
    volume: parseFloat(item[5]),
  }));
}

async function fetchBybitFunding(symbol: string, startTime: number, endTime: number): Promise<any[]> {
  await bybitLimiter.take();
  const params = new URLSearchParams({
    category: 'linear',
    symbol,
    startTime: startTime.toString(),
    endTime: endTime.toString(),
    limit: '200',
  });
  const url = `${config.bybit.restUrl}/v5/market/funding/history?${params}`;
  const res = await fetch(url);
  const json = await res.json() as any;
  if (json.retCode !== 0) throw new Error(`Bybit funding error: ${json.retMsg}`);
  return json.result.list.map((item: any) => ({
    timestamp: new Date(parseInt(item.fundingRateTimestamp)),
    fundingRate: parseFloat(item.fundingRate),
  }));
}

async function fetchKucoinKlines(symbol: string, granularity: number, from: number, to: number): Promise<any[]> {
  await kucoinLimiter.take();
  const url = `${config.kucoin.restUrl}/api/v1/kline/query?symbol=${symbol}&granularity=${granularity}&from=${from}&to=${to}`;
  const res = await fetch(url);
  const json = await res.json() as any;
  if (json.code !== '200000') throw new Error(`KuCoin kline error: ${json.msg}`);
  return json.data.map((item: any) => ({
    timestamp: new Date(item[0]),
    open: parseFloat(item[1]),
    high: parseFloat(item[2]),
    low: parseFloat(item[3]),
    close: parseFloat(item[4]),
    volume: parseFloat(item[5]),
  }));
}

async function fetchKucoinFunding(symbol: string, from: number, to: number): Promise<any[]> {
  await kucoinLimiter.take();
  const url = `${config.kucoin.restUrl}/api/v1/contract/funding-rates?symbol=${symbol}&from=${from}&to=${to}`;
  const res = await fetch(url);
  const json = await res.json() as any;
  if (json.code !== '200000') throw new Error(`KuCoin funding error: ${json.msg}`);
  return json.data.map((item: any) => ({
    timestamp: new Date(item.timestamp),
    fundingRate: parseFloat(item.fundingRate),
  }));
}

async function saveCandles(candles: CandleInput[]): Promise<void> {
  if (candles.length === 0) return;
  await prisma.$transaction(
    candles.map(c => prisma.historicalCandle.upsert({
      where: {
        exchange_symbol_interval_timestamp: {
          exchange: c.exchange,
          symbol: c.symbol,
          interval: c.interval,
          timestamp: c.timestamp,
        },
      },
      create: c,
      update: { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume },
    }))
  );
}

async function saveFunding(fundings: FundingInput[]): Promise<void> {
  if (fundings.length === 0) return;
  await prisma.$transaction(
    fundings.map(f => prisma.historicalFunding.upsert({
      where: {
        exchange_symbol_timestamp: {
          exchange: f.exchange,
          symbol: f.symbol,
          timestamp: f.timestamp,
        },
      },
      create: f,
      update: { fundingRate: f.fundingRate },
    }))
  );
}

export async function fetchSymbolHistory(
  standardSymbol: string,
  intervals: string[],
  startDate: Date,
  endDate: Date,
  batchDays = 7
): Promise<void> {
  const bybitSymbol = getByBybit(standardSymbol)?.bybit || standardSymbol;
  const kucoinSymbol = getByKucoin(standardSymbol)?.kucoin || standardSymbol.replace('USDT', 'USDTM');

  const intervalMap: Record<string, { bybit: string; kucoin: number }> = {
    '5m': { bybit: '5', kucoin: 5 },
    '15m': { bybit: '15', kucoin: 15 },
    '1h': { bybit: '60', kucoin: 60 },
    '4h': { bybit: '240', kucoin: 240 },
    '1d': { bybit: 'D', kucoin: 1440 },
  };

  let currentStart = new Date(startDate);
  while (currentStart < endDate) {
    const batchEnd = new Date(Math.min(currentStart.getTime() + batchDays * 86400000, endDate.getTime()));
    const startMs = currentStart.getTime();
    const endMs = batchEnd.getTime();

    console.log(`[FETCH] ${standardSymbol} ${currentStart.toISOString()} -> ${batchEnd.toISOString()}`);

    for (const interval of intervals) {
      const { bybit: bybitInterval, kucoin: kucoinInterval } = intervalMap[interval] || intervalMap['5m'];

      const [bybitCandles, kucoinCandles] = await Promise.all([
        (async () => {
          try {
            const data = await fetchBybitKlines(
              getByBybit(standardSymbol)?.bybit || standardSymbol,
              bybitInterval,
              startMs,
              endMs
            );
            return data.map((c: any) => ({
              exchange: 'bybit' as const,
              symbol: standardSymbol,
              interval,
              timestamp: c.timestamp,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            }));
          } catch (e) { console.error(`Bybit kline error for ${standardSymbol}:`, e); return []; }
        })(),
        (async () => {
          try {
            const kucoinSym = getByKucoin(standardSymbol)?.kucoin || standardSymbol.replace('USDT', 'USDTM');
            const data = await fetchKucoinKlines(kucoinSym, intervalMap[interval]?.kucoin || 5, startMs, endMs);
            return data.map((c: any) => ({
              exchange: 'kucoin' as const,
              symbol: standardSymbol,
              interval,
              timestamp: c.timestamp,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            }));
          } catch (e) { console.error(`KuCoin kline error for ${standardSymbol}:`, e); return []; }
        })(),
      ]);

      const allCandles: CandleInput[] = [
        ...bybitCandles.map(c => ({ ...c, exchange: 'bybit' as const, symbol: standardSymbol, interval })),
        ...kucoinCandles.map(c => ({ ...c, exchange: 'kucoin' as const, symbol: standardSymbol, interval })),
      ];
      await saveCandles(allCandles);
    }

    try {
      const [bybitFunding, kucoinFunding] = await Promise.all([
        fetchBybitFunding(
          getByBybit(standardSymbol)?.bybit || standardSymbol,
          startMs,
          endMs
        ),
        fetchKucoinFunding(
          getByKucoin(standardSymbol)?.kucoin || standardSymbol.replace('USDT', 'USDTM'),
          startMs,
          endMs
        ),
      ]);

      const bybitFundings: FundingInput[] = bybitFunding.map((f: any) => ({
        exchange: 'bybit' as const,
        symbol: standardSymbol,
        timestamp: f.timestamp,
        fundingRate: f.fundingRate,
      }));
      const kucoinFundings: FundingInput[] = kucoinFunding.map((f: any) => ({
        exchange: 'kucoin' as const,
        symbol: standardSymbol,
        timestamp: f.timestamp,
        fundingRate: f.fundingRate,
      }));

      await saveFunding([...bybitFundings, ...kucoinFundings]);
    } catch (e) {
      console.error(`Funding fetch error for ${standardSymbol}:`, e);
    }

    currentStart = batchEnd;
    await sleep(200);
  }
}

export async function backfillHistoricalData(
  symbols: string[],
  intervals: string[],
  startDate: Date,
  endDate: Date,
  batchDays = 7
): Promise<void> {
  console.log(`[BACKFILL] Starting for ${symbols.length} symbols, ${intervals.length} intervals`);
  
  for (const symbol of symbols) {
    await fetchSymbolHistory(symbol, intervals, startDate, endDate, batchDays);
    await sleep(500);
  }
  
  console.log('[BACKFILL] Complete');
}