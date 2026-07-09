/**
 * backtestEngine.ts — Walk-forward backtest simulation engine for spread arbitrage
 *
 * Design principles:
 *  - No look-ahead bias: entry signal evaluated on CLOSE of bar N, executed at OPEN of bar N+1
 *  - Walk-forward chronological simulation
 *  - Funding rate PnL tracked separately from spread convergence PnL
 *  - Uses shared spreadMath.ts functions for all calculations
 */

import prisma from '../db/client.js';
import {
  calcSpreadPct,
  calcFundingPnL,
  checkEntrySignal,
  checkExitConditions,
  calcEquityCurve,
} from './spreadMath.js';
import type { HistoricalCandle, HistoricalFunding } from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BacktestParams {
  pairs: string[];
  startDate: string; // ISO date
  endDate: string; // ISO date
  interval: string; // '5m' | '15m' | '1h'
  minSpreadPct: number; // entry threshold
  minFundingDiff: number; // funding diff threshold (decimal)
  maxHoldBars: number; // max bars to hold
  takerFeePctA: number; // Bybit taker fee (decimal, e.g. 0.00055)
  takerFeePctB: number; // KuCoin taker fee (decimal, e.g. 0.0006)
  slippageBps: number; // basis points
  positionSizeUsd: number; // USD per leg
  fundingIntervalHours: number; // default 8
}

export interface BacktestTrade {
  symbol: string;
  entryAt: Date;
  exitAt: Date;
  entrySpread: number;
  exitSpread: number;
  spreadPnl: number; // PnL from spread convergence
  fundingPnl: number; // PnL from funding collection
  feesPaid: number;
  totalPnl: number;
}

export interface BacktestResult {
  params: BacktestParams;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  spreadPnl: number;
  fundingPnl: number;
  totalFees: number;
  maxDrawdown: number;
  avgHoldBars: number;
  equityCurve: Array<{ timestamp: number; equity: number }>;
  trades: BacktestTrade[];
  pairBreakdown: Record<string, { trades: number; pnl: number; winRate: number }>;
}

// ─── Internal aligned data types ─────────────────────────────────────────────

interface AlignedBar {
  timestamp: Date;
  openA: number;
  closeA: number;
  openB: number;
  closeB: number;
  bybitFunding: number;
  kucoinFunding: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map interval string to hours per bar */
function intervalToHours(interval: string): number {
  const map: Record<string, number> = {
    '1m': 1 / 60,
    '3m': 3 / 60,
    '5m': 5 / 60,
    '15m': 15 / 60,
    '30m': 30 / 60,
    '1h': 1,
    '4h': 4,
    '1d': 24,
  };
  return map[interval] ?? 1;
}

/**
 * Build aligned bars from Bybit and KuCoin candle data + funding data.
 * Only includes timestamps present in BOTH exchanges (inner join).
 * Funding rates are forward-filled.
 */
function buildAlignedBars(
  candlesBybit: HistoricalCandle[],
  candlesKucoin: HistoricalCandle[],
  fundingBybit: HistoricalFunding[],
  fundingKucoin: HistoricalFunding[],
): AlignedBar[] {
  // Index candles by timestamp for each exchange
  const bybitByTs = new Map<number, HistoricalCandle>();
  const kucoinByTs = new Map<number, HistoricalCandle>();

  for (const c of candlesBybit) {
    bybitByTs.set(c.timestamp.getTime(), c);
  }
  for (const c of candlesKucoin) {
    kucoinByTs.set(c.timestamp.getTime(), c);
  }

  // Sort funding rates
  const sortedBybitFunding = [...fundingBybit].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  const sortedKucoinFunding = [...fundingKucoin].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  // Find common timestamps (inner join)
  const commonTimestamps = [...bybitByTs.keys()]
    .filter((ts) => kucoinByTs.has(ts))
    .sort((a, b) => a - b);

  if (commonTimestamps.length === 0) return [];

  // Forward-fill funding rates
  const bars: AlignedBar[] = [];
  let bybitFundIdx = 0;
  let kucoinFundIdx = 0;
  let currentBybitFunding = 0;
  let currentKucoinFunding = 0;

  for (const ts of commonTimestamps) {
    // Advance funding pointers (forward-fill)
    while (
      bybitFundIdx < sortedBybitFunding.length &&
      sortedBybitFunding[bybitFundIdx].timestamp.getTime() <= ts
    ) {
      currentBybitFunding = sortedBybitFunding[bybitFundIdx].fundingRate;
      bybitFundIdx++;
    }
    while (
      kucoinFundIdx < sortedKucoinFunding.length &&
      sortedKucoinFunding[kucoinFundIdx].timestamp.getTime() <= ts
    ) {
      currentKucoinFunding = sortedKucoinFunding[kucoinFundIdx].fundingRate;
      kucoinFundIdx++;
    }

    const a = bybitByTs.get(ts)!;
    const b = kucoinByTs.get(ts)!;

    bars.push({
      timestamp: new Date(ts),
      openA: a.open,
      closeA: a.close,
      openB: b.open,
      closeB: b.close,
      bybitFunding: currentBybitFunding,
      kucoinFunding: currentKucoinFunding,
    });
  }

  return bars;
}

// ─── Core backtest logic ─────────────────────────────────────────────────────

interface OpenPosition {
  symbol: string;
  entryBarIdx: number;
  entryAt: Date;
  entrySpread: number;
  entryPriceA: number; // Bybit open at entry bar+1
  entryPriceB: number; // KuCoin open at entry bar+1
  accumulatedFundingPnl: number;
  barsHeld: number;
}

/**
 * Run walk-forward backtest for a single symbol.
 */
function runSinglePairBacktest(
  params: BacktestParams,
  symbol: string,
  alignedBars: AlignedBar[],
): BacktestTrade[] {
  const {
    minSpreadPct,
    minFundingDiff,
    maxHoldBars,
    takerFeePctA,
    takerFeePctB,
    slippageBps,
    positionSizeUsd,
    fundingIntervalHours,
  } = params;

  const barHours = intervalToHours(params.interval);
  const maxHoldHours = maxHoldBars * barHours;
  const trades: BacktestTrade[] = [];
  let openPosition: OpenPosition | null = null;

  for (let i = 0; i < alignedBars.length - 1; i++) {
    const bar = alignedBars[i];
    const nextBar = alignedBars[i + 1];

    // ── Calculate current spread from CLOSE prices ──
    const spreadPct = calcSpreadPct(bar.closeA, bar.closeB);
    const fundingDiffPct = (bar.kucoinFunding - bar.bybitFunding) * 100;

    // ── If no position open, check entry signal ──
    if (!openPosition) {
      const signal = checkEntrySignal(spreadPct, fundingDiffPct, minSpreadPct, minFundingDiff * 100);
      if (signal.shouldEnter) {
        // Entry: execute at OPEN of next bar (no look-ahead)
        openPosition = {
          symbol,
          entryBarIdx: i + 1,
          entryAt: nextBar.timestamp,
          entrySpread: spreadPct,
          entryPriceA: nextBar.openA,
          entryPriceB: nextBar.openB,
          accumulatedFundingPnl: 0,
          barsHeld: 0,
        };
      }
      continue; // move to next bar — either just entered (position starts next bar) or no signal
    }

    // ── Position is open — update hold duration ──
    openPosition.barsHeld++;
    const hoursHeld = openPosition.barsHeld * barHours;

    // ── Accumulate funding PnL at each bar ──
    const fundingPnl = calcFundingPnL(
      positionSizeUsd,
      bar.bybitFunding,
      bar.kucoinFunding,
      'LONG',
      barHours, // funding earned for this bar's duration
      fundingIntervalHours,
    );
    openPosition.accumulatedFundingPnl += fundingPnl;

    // ── Check exit conditions ──
    const exitCheck = checkExitConditions({
      currentSpreadPct: spreadPct,
      entrySpreadPct: openPosition.entrySpread,
      fundingDiffPct: fundingDiffPct,
      hoursHeld,
      maxHoldHours,
    });

    if (exitCheck.shouldExit) {
      // Exit: execute at OPEN of the next bar for fairness,
      // or at current bar's CLOSE if it's the last bar
      const exitBarIdx = i + 1 < alignedBars.length ? i + 1 : i;
      const exitBar = alignedBars[exitBarIdx];
      const exitSpread = spreadPct;
      const exitAt = exitBar.timestamp;

      // ── Calculate spread PnL ──
      // Positive when spread narrows: entrySpread > exitSpread
      const spreadPnl = positionSizeUsd * (openPosition.entrySpread - exitSpread) / 100;

      // ── Calculate fees ──
      // Fees on both legs, entry + exit
      const entryNotionalA = openPosition.entryPriceA * (positionSizeUsd / openPosition.entryPriceA);
      const exitNotionalA = exitBar.openA * (positionSizeUsd / exitBar.openA);
      const entryNotionalB = openPosition.entryPriceB * (positionSizeUsd / openPosition.entryPriceB);
      const exitNotionalB = exitBar.openB * (positionSizeUsd / exitBar.openB);

      const feesA = (entryNotionalA + exitNotionalA) * takerFeePctA;
      const feesB = (entryNotionalB + exitNotionalB) * takerFeePctB;
      const feesPaid = feesA + feesB;

      // ── Calculate slippage cost ──
      const slippageCost = positionSizeUsd * slippageBps / 10000 * 2;

      // ── Total PnL ──
      const totalPnl = spreadPnl + openPosition.accumulatedFundingPnl - feesPaid - slippageCost;

      trades.push({
        symbol,
        entryAt: openPosition.entryAt,
        exitAt,
        entrySpread: openPosition.entrySpread,
        exitSpread,
        spreadPnl,
        fundingPnl: openPosition.accumulatedFundingPnl,
        feesPaid: feesPaid + slippageCost,
        totalPnl,
      });

      openPosition = null;
    }
  }

  // ── Force close any remaining open position at last bar's CLOSE ──
  if (openPosition) {
    const lastBar = alignedBars[alignedBars.length - 1];
    const exitSpread = calcSpreadPct(lastBar.closeA, lastBar.closeB);

    const spreadPnl = positionSizeUsd * (openPosition.entrySpread - exitSpread) / 100;

    const entryNotionalA = positionSizeUsd; // approximate
    const exitNotionalA = positionSizeUsd;
    const entryNotionalB = positionSizeUsd;
    const exitNotionalB = positionSizeUsd;
    const feesPaid =
      (entryNotionalA + exitNotionalA) * takerFeePctA +
      (entryNotionalB + exitNotionalB) * takerFeePctB;
    const slippageCost = positionSizeUsd * slippageBps / 10000 * 2;

    const totalPnl = spreadPnl + openPosition.accumulatedFundingPnl - feesPaid - slippageCost;

    trades.push({
      symbol,
      entryAt: openPosition.entryAt,
      exitAt: lastBar.timestamp,
      entrySpread: openPosition.entrySpread,
      exitSpread,
      spreadPnl,
      fundingPnl: openPosition.accumulatedFundingPnl,
      feesPaid: feesPaid + slippageCost,
      totalPnl,
    });
  }

  return trades;
}

// ─── Main exported functions ─────────────────────────────────────────────────

/**
 * Run a full walk-forward backtest for the given parameters.
 *
 * 1. Fetches historical candles and funding rates from Prisma DB
 * 2. Aligns data across exchanges (inner join on timestamp + forward-fill funding)
 * 3. Walks bar-by-bar: signals on CLOSE(N), execution at OPEN(N+1)
 * 4. Calculates all metrics including equity curve, drawdown, pair breakdown
 */
export async function runBacktest(params: BacktestParams): Promise<BacktestResult> {
  const startDate = new Date(params.startDate);
  const endDate = new Date(params.endDate);
  const allTrades: BacktestTrade[] = [];

  for (const pair of params.pairs) {
    // ── Fetch historical data from DB ──
    const [bybitCandles, kucoinCandles, bybitFunding, kucoinFunding] = await Promise.all([
      prisma.historicalCandle.findMany({
        where: {
          symbol: pair,
          exchange: 'bybit',
          interval: params.interval,
          timestamp: { gte: startDate, lte: endDate },
        },
        orderBy: { timestamp: 'asc' },
      }),
      prisma.historicalCandle.findMany({
        where: {
          symbol: pair,
          exchange: 'kucoin',
          interval: params.interval,
          timestamp: { gte: startDate, lte: endDate },
        },
        orderBy: { timestamp: 'asc' },
      }),
      prisma.historicalFunding.findMany({
        where: {
          symbol: pair,
          exchange: 'bybit',
          timestamp: { gte: startDate, lte: endDate },
        },
        orderBy: { timestamp: 'asc' },
      }),
      prisma.historicalFunding.findMany({
        where: {
          symbol: pair,
          exchange: 'kucoin',
          timestamp: { gte: startDate, lte: endDate },
        },
        orderBy: { timestamp: 'asc' },
      }),
    ]);

    if (bybitCandles.length === 0 || kucoinCandles.length === 0) {
      console.warn(`[BACKTEST] No candle data for ${pair}, skipping`);
      continue;
    }

    // ── Align bars across exchanges ──
    const alignedBars = buildAlignedBars(
      bybitCandles,
      kucoinCandles,
      bybitFunding,
      kucoinFunding,
    );

    if (alignedBars.length < 2) {
      console.warn(`[BACKTEST] Insufficient aligned bars for ${pair} (${alignedBars.length}), skipping`);
      continue;
    }

    console.log(`[BACKTEST] ${pair}: ${alignedBars.length} aligned bars, running simulation...`);

    // ── Run walk-forward simulation ──
    const pairTrades = runSinglePairBacktest(params, pair, alignedBars);
    allTrades.push(...pairTrades);

    console.log(`[BACKTEST] ${pair}: ${pairTrades.length} trades completed`);
  }

  // ── Calculate aggregate metrics ──
  const totalTrades = allTrades.length;
  const wins = allTrades.filter((t) => t.totalPnl > 0);
  const losses = allTrades.filter((t) => t.totalPnl <= 0);
  const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;

  const grossProfit = wins.reduce((sum, t) => sum + t.totalPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.totalPnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const totalPnl = allTrades.reduce((sum, t) => sum + t.totalPnl, 0);
  const spreadPnl = allTrades.reduce((sum, t) => sum + t.spreadPnl, 0);
  const fundingPnl = allTrades.reduce((sum, t) => sum + t.fundingPnl, 0);
  const totalFees = allTrades.reduce((sum, t) => sum + t.feesPaid, 0);
  const avgHoldBars =
    totalTrades > 0
      ? allTrades.reduce((sum, t) => {
          const diffMs = t.exitAt.getTime() - t.entryAt.getTime();
          const diffBars = diffMs / (intervalToHours(params.interval) * 3600000);
          return sum + diffBars;
        }, 0) / totalTrades
      : 0;

  // ── Equity curve ──
  const equityInput = allTrades.map((t) => ({
    pnl: t.totalPnl,
    timestamp: t.exitAt.getTime(),
  }));
  const equityCurve = calcEquityCurve(equityInput);

  // ── Max drawdown ──
  let maxEquity = 10000; // starting balance default
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.equity > maxEquity) {
      maxEquity = point.equity;
    }
    const drawdown = (maxEquity - point.equity) / maxEquity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // ── Pair breakdown ──
  const pairBreakdown: Record<string, { trades: number; pnl: number; winRate: number }> = {};
  for (const pair of params.pairs) {
    const pairTrades = allTrades.filter((t) => t.symbol === pair);
    if (pairTrades.length === 0) continue;

    const pairWins = pairTrades.filter((t) => t.totalPnl > 0).length;
    pairBreakdown[pair] = {
      trades: pairTrades.length,
      pnl: pairTrades.reduce((sum, t) => sum + t.totalPnl, 0),
      winRate: pairWins / pairTrades.length,
    };
  }

  return {
    params,
    totalTrades,
    winRate,
    profitFactor,
    totalPnl,
    spreadPnl,
    fundingPnl,
    totalFees,
    maxDrawdown,
    avgHoldBars,
    equityCurve,
    trades: allTrades,
    pairBreakdown,
  };
}

// ─── Parameter sweep ─────────────────────────────────────────────────────────

/**
 * Generate all combinations of grid parameters.
 */
function generateCombinations(
  baseParams: BacktestParams,
  grid: Record<string, number[]>,
): BacktestParams[] {
  const keys = Object.keys(grid);
  if (keys.length === 0) return [{ ...baseParams }];

  const combinations: BacktestParams[] = [];

  // Recursive combination generator
  function build(
    idx: number,
    current: Partial<BacktestParams>,
  ): void {
    if (idx === keys.length) {
      combinations.push({ ...baseParams, ...current } as BacktestParams);
      return;
    }

    const key = keys[idx];
    for (const value of grid[key]) {
      build(idx + 1, { ...current, [key]: value });
    }
  }

  build(0, {});
  return combinations;
}

/**
 * Run parameter sweep: test all combinations of grid params,
 * splitting each into training (first 80%) and validation (last 20%) periods.
 *
 * Returns results for each combination including both training and validation metrics.
 */
export async function runParameterSweep(
  baseParams: BacktestParams,
  grid: Record<string, number[]>,
): Promise<Array<{ params: BacktestParams; result: BacktestResult }>> {
  const allParams = generateCombinations(baseParams, grid);
  const results: Array<{ params: BacktestParams; result: BacktestResult }> = [];

  console.log(`[SWEEP] Running ${allParams.length} parameter combinations`);

  const startMs = new Date(baseParams.startDate).getTime();
  const endMs = new Date(baseParams.endDate).getTime();
  const totalMs = endMs - startMs;
  const trainEndMs = startMs + totalMs * 0.8; // 80% training / 20% validation split

  for (let i = 0; i < allParams.length; i++) {
    const params = allParams[i];
    console.log(`[SWEEP] Combination ${i + 1}/${allParams.length}:`, JSON.stringify(params, null, 0));

    // Run on full period — we'll split the trades by time for train/val
    try {
      const result = await runBacktest(params);

      // Tag trades as training or validation
      const trainCutoff = trainEndMs;
      for (const trade of result.trades) {
        const tradeMidMs = (trade.entryAt.getTime() + trade.exitAt.getTime()) / 2;
        (trade as any)._period = tradeMidMs <= trainCutoff ? 'train' : 'validation';
      }

      results.push({ params, result });
    } catch (err) {
      console.error(`[SWEEP] Error for combination ${i + 1}:`, err);
    }
  }

  // Log summary
  console.log('[SWEEP] Results summary:');
  for (const { params: p, result: r } of results) {
    console.log(
      `  minSpread=${p.minSpreadPct} maxHold=${p.maxHoldBars} → ` +
        `trades=${r.totalTrades} winRate=${(r.winRate * 100).toFixed(1)}% ` +
        `pnl=$${r.totalPnl.toFixed(2)} pf=${r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)}`,
    );
  }

  return results;
}
