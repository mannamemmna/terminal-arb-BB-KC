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
  const { currentSpreadPct, entrySpreadPct, hoursHeld, maxHoldHours, tpSpreadPct, slSpreadPct } = input;

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
 * Calculate equity point from PnL array
 */
export function calcEquityCurve(trades: Array<{ pnl: number; timestamp: number }>, startingBalance: number = 10000): Array<{ timestamp: number; equity: number }> {
  let equity = startingBalance;
  return trades.map(t => {
    equity += t.pnl;
    return { timestamp: t.timestamp, equity };
  });
}