import { defaultThresholds, type ThresholdConfig } from '../config/thresholds.js';
import type { SpreadResult, SignalLog } from '../connectors/types.js';

export interface MarketSnapshot {
  symbol: string;
  bybitPrice: number | null;
  bybitFunding: number | null;
  bybitVolume: number | null;
  bybitUpdated: number | null;
  kucoinPrice: number | null;
  kucoinFunding: number | null;
  kucoinVolume: number | null;
  kucoinUpdated: number | null;
}

type SpreadCallback = (result: SpreadResult) => void;
type SignalCallback = (log: SignalLog) => void;

export class SpreadCalculator {
  private data = new Map<string, MarketSnapshot>();
  private changeCbs: Array<(symbol: string) => void> = [];
  private spreadCb: SpreadCallback | null = null;
  private signalCb: SignalCallback | null = null;
  private lastEmit = new Map<string, number>();
  private lastSignal = new Map<string, number>();

  thresholds: ThresholdConfig = { ...defaultThresholds };

  onChange(cb: (symbol: string) => void): void { this.changeCbs.push(cb); }
  onSpread(cb: SpreadCallback): void { this.spreadCb = cb; }
  onSignal(cb: SignalCallback): void { this.signalCb = cb; }

  setBybit(symbol: string, price: number, funding: number, volume: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    const snap = this.data.get(symbol) || this.empty(symbol);
    snap.bybitPrice = price; snap.bybitFunding = funding;
    snap.bybitVolume = volume; snap.bybitUpdated = Date.now();
    this.data.set(symbol, snap);
    this.emit(symbol);
  }

  setKucoin(symbol: string, price: number, funding: number, volume: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    const snap = this.data.get(symbol) || this.empty(symbol);
    snap.kucoinPrice = price; snap.kucoinFunding = funding;
    snap.kucoinVolume = volume; snap.kucoinUpdated = Date.now();
    this.data.set(symbol, snap);
    this.emit(symbol);
  }

  get(symbol: string): MarketSnapshot | undefined { return this.data.get(symbol); }
  keys(): string[] { return Array.from(this.data.keys()); }

  getAll(): MarketSnapshot[] {
    return Array.from(this.data.values()).filter(s => s.bybitPrice !== null || s.kucoinPrice !== null);
  }

  hasBoth(symbol: string): boolean {
    const s = this.data.get(symbol);
    return !!s && s.bybitPrice !== null && s.kucoinPrice !== null;
  }

  getStaleSymbols(): string[] {
    const now = Date.now();
    return Array.from(this.data.entries())
      .filter(([_, s]) => (s.bybitUpdated && now - s.bybitUpdated > 30_000) || (s.kucoinUpdated && now - s.kucoinUpdated > 30_000))
      .map(([sym]) => sym);
  }

  get avgAge(): number {
    const now = Date.now(); let total = 0, count = 0;
    for (const s of this.data.values()) {
      if (s.bybitUpdated) { total += now - s.bybitUpdated; count++; }
      if (s.kucoinUpdated) { total += now - s.kucoinUpdated; count++; }
    }
    return count > 0 ? total / count : Infinity;
  }

  /** Compute spread for all symbols */
  computeAll(): SpreadResult[] {
    const results: SpreadResult[] = [];
    for (const snap of this.getAll()) {
      if (snap.bybitPrice === null || snap.kucoinPrice === null) continue;
      const r = this.calc(snap);
      if (r) results.push(r);
    }
    results.sort((a, b) => Math.abs(b.spreadPct) - Math.abs(a.spreadPct));
    return results;
  }

  compute(symbol: string): SpreadResult | null {
    const snap = this.data.get(symbol);
    if (!snap || snap.bybitPrice === null || snap.kucoinPrice === null) return null;
    return this.calc(snap);
  }

  private emit(symbol: string): void {
    const snap = this.data.get(symbol);
    if (!snap || snap.bybitPrice === null || snap.kucoinPrice === null) return;

    // Throttle
    const now = Date.now();
    const last = this.lastEmit.get(symbol) || 0;
    if (now - last < this.thresholds.throttleMs) return;
    this.lastEmit.set(symbol, now);

    const result = this.calc(snap);
    if (!result) return;
    this.spreadCb?.(result);

    // Signal generation
    if (now - (this.lastSignal.get(symbol) || 0) > 10_000) {
      if (result.verdict === 'SAFE') {
        this.lastSignal.set(symbol, now);
        const dir = result.fundingDiff > 0 ? 'LONG Bybit / SHORT KuCoin' : 'SHORT Bybit / LONG KuCoin';
        this.signalCb?.({ timestamp: new Date(), message: `[SIGNAL] ${result.symbol}: Spread ${result.spreadPct.toFixed(2)}% > threshold. Funding diff ${(result.fundingDiff * 100).toFixed(3)}%. Direction: ${dir}` });
      } else if (result.verdict === 'WATCH') {
        this.lastSignal.set(symbol, now);
        this.signalCb?.({ timestamp: new Date(), message: `[WATCH] ${result.symbol}: Spread ${result.spreadPct.toFixed(2)}% entering watch zone` });
      }
    }

    for (const cb of this.changeCbs) cb(symbol);
  }

  private calc(snap: MarketSnapshot): SpreadResult | null {
    const bp = snap.bybitPrice!, kp = snap.kucoinPrice!;
    const mid = (bp + kp) / 2;
    if (mid === 0) return null;
    // Sanity check: reject spread > 10% (likely symbol mismatch or bad data)
    if (Math.abs(bp - kp) / mid > 0.1) return null;
    return {
      symbol: snap.symbol,
      bybitPrice: +bp.toFixed(2),
      kucoinPrice: +kp.toFixed(2),
      spreadPct: +(Math.abs(bp - kp) / mid * 100).toFixed(4),
      spreadPrice: +Math.abs(bp - kp).toFixed(2),
      fundingBybit: +(snap.bybitFunding ?? 0).toFixed(6),
      fundingKucoin: +(snap.kucoinFunding ?? 0).toFixed(6),
      fundingDiff: +((snap.bybitFunding ?? 0) - (snap.kucoinFunding ?? 0)).toFixed(6),
      volume24h: Math.max(snap.bybitVolume ?? 0, snap.kucoinVolume ?? 0),
      verdict: snap.bybitPrice !== null && snap.kucoinPrice !== null
        ? (Math.abs(bp - kp) / mid * 100 > this.thresholds.spreadThreshold && Math.abs((snap.bybitFunding ?? 0) - (snap.kucoinFunding ?? 0)) > this.thresholds.minFundingDiff
          ? 'SAFE' : Math.abs(bp - kp) / mid * 100 > this.thresholds.spreadThreshold * 0.6 ? 'WATCH' : 'SKIP')
        : 'SKIP',
      timestamp: Date.now(),
    };
  }

  private empty(symbol: string): MarketSnapshot {
    return { symbol, bybitPrice: null, bybitFunding: null, bybitVolume: null, bybitUpdated: null, kucoinPrice: null, kucoinFunding: null, kucoinVolume: null, kucoinUpdated: null };
  }
}
