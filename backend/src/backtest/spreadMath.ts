/**
 * spreadMath.ts — Shared pure math functions for spread arbitrage
 * Used by both live SpreadCalculator and BacktestEngine
 * Single source of truth for all spread/PnL calculations
 */

export interface SpreadInput {
  bybitPrice: number;
  kucoinPrice: number;
  bybitFunding: number;
  kucoinFunding: number;
  bybitVolume24h: number;
  kucoinVolume24h: number;
}

export interface SpreadResult {
  spreadPct: number;
  spreadAbs: number;
  fundingDiff: number;
  fundingDiffPct: number;
  midPrice: number;
  volume24h: number;
}

export interface PnLInput {
  entryPriceA: number;
  exitPriceA: number;
  sideA: 'LONG' | 'SHORT';
  entryPriceB: number;
  exitPriceB: number;
  sideB: 'LONG' | 'SHORT';
  size: number;
  feePctA: number;
  feePctB: number;
  slippageBps: number;
  fundingPnL: number;
}

export interface PnLResult {
  pnlLegA: number;
  pnlLegB: number;
  feeCostA: number;
  feeCostB: number;
  slippageCostA: number;
  slippageCostB: number;
  fundingPnL: number;
  totalPnL: number;
}

/**
 * Calculate spread percentage between two prices
 * spread% = |priceA - priceB| / ((priceA + priceB) / 2) * 100
 */
export function calcSpreadPct(priceA: number, priceB: number): number {
  if (priceA <= 0 || priceB <= 0) return 0;
  const mid = (priceA + priceB) / 2;
  return (Math.abs(priceA - priceB) / mid) * 100;
}

/**
 * Calculate absolute spread in quote currency
 */
export function calcSpreadAbs(priceA: number, priceB: number): number {
  return Math.abs(priceA - priceB);
}

/**
 * Full spread calculation from raw inputs
 */
export function calcSpread(input: SpreadInput): SpreadResult {
  const spreadPct = calcSpreadPct(input.bybitPrice, input.kucoinPrice);
  const spreadAbs = calcSpreadAbs(input.bybitPrice, input.kucoinPrice);
  const fundingDiff = input.bybitFunding - input.kucoinFunding;
  const fundingDiffPct = fundingDiff * 100; // funding rates are already in decimal (e.g., 0.0001 = 0.01%)
  const midPrice = (input.bybitPrice + input.kucoinPrice) / 2;
  const volume24h = Math.max(input.bybitVolume24h, input.kucoinVolume24h);

  return {
    spreadPct,
    spreadAbs,
    fundingDiff,
    fundingDiffPct,
    midPrice,
    volume24h,
  };
}

/**
 * Calculate funding PnL for a given position
 * fundingPnL = notional * fundingRate * (side === 'LONG' ? -1 : 1) * (hoursHeld / fundingIntervalHours)
 * 
 * For perp perp arb:
 * - Bybit LONG / KuCoin SHORT: Bybit pays funding, KuCoin receives → net = (kucoinFunding - bybitFunding) * notional
 * - Bybit SHORT / KuCoin LONG: Bybit receives, KuCoin pays → net = (bybitFunding - kucoinFunding) * notional
 */
export function calcFundingPnL(
  notional: number,
  bybitFunding: number,
  kucoinFunding: number,
  sideBybit: 'LONG' | 'SHORT',
  hoursHeld: number,
  fundingIntervalHours: number = 8
): number {
  const fundingDiff = kucoinFunding - bybitFunding; // positive = kucoin pays more
  const intervals = hoursHeld / fundingIntervalHours;
  
  // Bybit LONG pays bybitFunding, KuCoin SHORT receives kucoinFunding
  // Net = (kucoinFunding - bybitFunding) * notional * intervals
  // If Bybit is SHORT, it receives funding → flip sign
  const sign = 1; // Bybit LONG / KuCoin SHORT is our default arb direction
  
  return notional * (kucoinFunding - bybitFunding) * (hoursHeld / fundingIntervalHours) * sign;
}

/**
 * Calculate PnL from entry to exit with all costs
 * Uses leg-level calculation for accuracy
 */
export function calcPnL(input: PnLInput): PnLResult {
  const { entryPriceA, exitPriceA, sideA, entryPriceB, exitPriceB, sideB, size, feePctA, feePctB, slippageBps, fundingPnL } = input;

  // Leg A PnL
  const priceDiffA = exitPriceA - entryPriceA;
  const multA = sideA === 'LONG' ? 1 : -1;
  const pnlLegA = priceDiffA * size * multA;

  // Leg B PnL
  const priceDiffB = exitPriceB - entryPriceB;
  const multB = sideB === 'LONG' ? 1 : -1;
  const pnlLegB = priceDiffB * size * multB;

  // Fee costs (on notional at entry + exit)
  const notionalEntryA = entryPriceA * size;
  const notionalExitA = exitPriceA * size;
  const feeCostA = (notionalEntryA + notionalExitA) * feePctA;

  const notionalEntryB = entryPriceB * size;
  const notionalExitB = exitPriceB * size;
  const feeCostB = (notionalEntryB + notionalExitB) * feePctB;

  // Slippage costs
  const slippagePct = slippageBps / 10000;
  const slippageCostA = (entryPriceA * size + exitPriceA * size) * slippagePct;
  const slippageCostB = (entryPriceB * size + exitPriceB * size) * slippagePct;

  const totalPnL = pnlLegA + pnlLegB - feeCostA - feeCostB - slippageCostA - slippageCostB + fundingPnL;

  return {
    pnlLegA,
    pnlLegB,
    feeCostA,
    feeCostB,
    slippageCostA,
    slippageCostB,
    fundingPnL,
    totalPnL,
  };
}

/**
 * Check if spread meets threshold criteria for entry
 */
export function checkEntrySignal(
  spreadPct: number,
  fundingDiffPct: number,
  minSpreadPct: number,
  minFundingDiffPct: number
): { verdict: 'SAFE' | 'WATCH' | 'SKIP'; shouldEnter: boolean } {
  const fundingCheck = minFundingDiffPct > 0 
    ? Math.abs(fundingDiffPct) >= minFundingDiffPct 
    : true;
  if (spreadPct > minSpreadPct && fundingCheck) {
    return { verdict: 'SAFE', shouldEnter: true };
  } else if (spreadPct > minSpreadPct * 0.6) {
    return { verdict: 'WATCH', shouldEnter: false };
  }
  return { verdict: 'SKIP', shouldEnter: false };
}

/**
 * Check exit conditions for an open position
 */
export interface ExitCheckInput {
  currentSpreadPct: number;
  entrySpreadPct: number;
  fundingDiffPct: number;
  hoursHeld: number;
  maxHoldHours: number;
  tpSpreadPct?: number; // take profit at spread reversion
  slSpreadPct?: number; // stop loss at spread widening
}

export function checkExitConditions(input: ExitCheckInput): { shouldExit: boolean; reason: string } {
  const { currentSpreadPct, entrySpreadPct, fundingDiffPct, hoursHeld, maxHoldHours, tpSpreadPct, slSpreadPct } = input;

  // Take profit: spread reverted significantly
  if (tpSpreadPct && input.currentSpreadPct <= tpSpreadPct) {
    return { shouldExit: true, reason: `TP: spread ${currentSpreadPct.toFixed(4)}% <= ${tpSpreadPct}%` };
  }

  // Stop loss: spread widened
  if (slSpreadPct && input.currentSpreadPct >= slSpreadPct) {
    return { shouldExit: true, reason: `SL: spread ${input.currentSpreadPct.toFixed(4)}% >= ${slSpreadPct}%` };
  }

  // Max hold time
  if (hoursHeld >= maxHoldHours) {
    return { shouldExit: true, reason: `MAX_HOLD: ${hoursHeld.toFixed(1)}h >= ${maxHoldHours}h` };
  }

  // Mean reversion: spread reverted towards entry
  if (currentSpreadPct <= entrySpreadPct * 0.3) {
    return { shouldExit: true, reason: `MEAN_REVERSION: spread ${currentSpreadPct.toFixed(4)}% near zero` };
  }

  return { shouldExit: false, reason: '' };
}

/**
 * Calculate equity curve from trades
 */
export function calcEquityCurve(trades: Array<{ pnl: number; timestamp: number }>, startingBalance: number = 10000): Array<{ timestamp: number; equity: number }> {
  let equity = startingBalance;
  return trades.map(t => {
    equity += t.pnl;
    return { timestamp: t.timestamp, equity };
  });
}

export interface RollingStats {
  mean: number;
  std: number;
  count: number;
}

/**
 * Rolling window for per-symbol spread tracking
 * Use this in SpreadCalculator for live z-score tracking
 */
export class RollingWindow {
  private values: number[] = [];
  private maxSize: number;
  private sum = 0;
  private sumSq = 0;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  push(value: number): void {
    this.values.push(value);
    this.sum += value;
    this.sumSq += value * value;

    if (this.values.length > this.maxSize) {
      const removed = this.values.shift()!;
      this.sum -= removed;
      this.sumSq -= removed * removed;
    }
  }

  getStats(): RollingStats {
    const count = this.values.length;
    const mean = count > 0 ? this.sum / count : 0;
    const variance = count > 1 ? (this.sumSq / count) - (mean * mean) : 0;
    const std = count > 1 ? Math.sqrt(Math.max(0, variance)) : 0;
    return { mean, std, count };
  }

  calcZScore(value: number): { zScore: number; stats: RollingStats } {
    const stats = this.getStats();
    const zScore = stats.std > 0 ? (value - stats.mean) / stats.std : 0;
    return { zScore, stats };
  }

  size(): number {
    return this.values.length;
  }

  reset(): void {
    this.values = [];
    this.sum = 0;
    this.sumSq = 0;
  }
}

/**
 * Opportunity classification based on spread behavior
 */
export type OpportunityType = 'mean_reversion' | 'funding_arbitrage' | 'hybrid' | 'none';

export interface OpportunityClassification {
  type: OpportunityType;
  zScore: number;
  spreadPct: number;
  fundingDiffPct: number;
  confidence: number; // 0-1
  reason: string;
}

/**
 * Classify the opportunity type based on spread behavior and funding
 * - mean_reversion: high z-score spread, low funding diff → expect reversion
 * - funding_arbitrage: low z-score spread, high funding diff → collect funding
 * - hybrid: both significant → combined edge
 * - none: no clear edge
 */
export function classifyOpportunity(
  spreadPct: number,
  fundingDiffPct: number,
  spreadZScore: number,
  thresholds: {
    zScoreEntry: number;      // e.g., 2.0
    zScoreExit: number;       // e.g., 0.5
    fundingDiffMin: number;   // e.g., 0.01% (0.0001 in decimal)
    spreadPctMin: number;     // e.g., 0.1%
  }
): OpportunityClassification {
  const absZScore = Math.abs(spreadZScore);
  const absFundingDiff = Math.abs(fundingDiffPct);
  
  // No opportunity if spread too small
  if (spreadPct < thresholds.spreadPctMin) {
    return {
      type: 'none',
      zScore: spreadZScore,
      spreadPct,
      fundingDiffPct,
      confidence: 0,
      reason: `Spread ${spreadPct.toFixed(4)}% below minimum ${thresholds.spreadPctMin}%`
    };
  }

  const highZScore = absZScore >= thresholds.zScoreEntry;
  const significantFunding = absFundingDiff >= thresholds.fundingDiffMin;

  let type: OpportunityType;
  let confidence: number;
  let reason: string;

  if (highZScore && significantFunding) {
    type = 'hybrid';
    confidence = Math.min(0.95, (absZScore / thresholds.zScoreEntry) * 0.5 + (absFundingDiff / thresholds.fundingDiffMin) * 0.5);
    reason = `Hybrid: z-score=${spreadZScore.toFixed(2)}, fundingDiff=${fundingDiffPct.toFixed(4)}%`;
  } else if (highZScore) {
    type = 'mean_reversion';
    confidence = Math.min(0.9, absZScore / thresholds.zScoreEntry);
    reason = `Mean reversion: z-score=${spreadZScore.toFixed(2)}`;
  } else if (significantFunding) {
    type = 'funding_arbitrage';
    confidence = Math.min(0.85, absFundingDiff / thresholds.fundingDiffMin);
    reason = `Funding arb: fundingDiff=${fundingDiffPct.toFixed(4)}%`;
  } else {
    type = 'none';
    confidence = 0;
    reason = `No clear edge: z-score=${spreadZScore.toFixed(2)}, fundingDiff=${fundingDiffPct.toFixed(4)}%`;
  }

  return { type, zScore: spreadZScore, spreadPct, fundingDiffPct, confidence, reason };
}

/**
 * Calculate exit target based on opportunity type
 */
export function calcExitTarget(
  entrySpread: number,
  entryZScore: number,
  opportunityType: OpportunityType,
  zScoreExit: number = 0.5
): { targetSpread: number; targetZScore: number; reason: string } {
  switch (opportunityType) {
    case 'mean_reversion':
      // Target z-score reversion to exit level
      return {
        targetSpread: 0, // Full reversion
        targetZScore: entryZScore > 0 ? 0.5 : -0.5,
        reason: `Mean reversion target z=0.5`
      };
    case 'funding_arbitrage':
      // Hold for funding, exit on spread widening or funding change
      return {
        targetSpread: entrySpread * 1.5, // Stop if spread widens 50%
        targetZScore: 0,
        reason: 'Funding arb: exit on spread widening or funding shift'
      };
    case 'hybrid':
      // Balanced: exit on either mean reversion or funding shift
      return {
        targetSpread: entrySpread * 0.3, // 70% reversion
        targetZScore: entryZScore > 0 ? 0.5 : -0.5,
        reason: 'Hybrid: exit on reversion or funding shift'
      };
    default:
      return {
        targetSpread: entrySpread * 0.5,
        targetZScore: 0,
        reason: 'Default exit'
      };
  }
}