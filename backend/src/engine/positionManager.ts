import type { BybitTrader } from '../connectors/bybit.trader.js';
import type { KucoinTrader } from '../connectors/kucoin.trader.js';

export interface SizingResult {
  canEnter: boolean;
  reason?: string;
  size: number;
}

export class PositionManager {
  private maxConcurrent = 5;
  private maxAllocationPct = 20; // % of equity per pair
  private defaultLeverage = 3;
  private totalPositions = 0;

  constructor(
    private bybit: BybitTrader,
    private kucoin: KucoinTrader,
  ) {}

  async canEnter(symbol: string, entryPrice: number): Promise<SizingResult> {
    // Check concurrent limit
    if (this.totalPositions >= this.maxConcurrent) {
      return { canEnter: false, reason: `Max concurrent positions (${this.maxConcurrent})`, size: 0 };
    }

    // Check balance on both exchanges
    const [byBal, kucBal] = await Promise.all([this.bybit.getBalance(), this.kucoin.getBalance()]);

    if (byBal.availableBalance <= 0 || kucBal.availableBalance <= 0) {
      return { canEnter: false, reason: 'Insufficient balance on one or both exchanges', size: 0 };
    }

    // Use the smaller available balance for sizing
    const minAvail = Math.min(byBal.availableBalance, kucBal.availableBalance);
    const allocation = minAvail * (this.maxAllocationPct / 100);
    const leveragedAlloc = allocation * this.defaultLeverage;
    const rawSize = leveragedAlloc / entryPrice;

    // Round to reasonable size
    const size = Math.max(0.001, Math.round(rawSize * 1000) / 1000);

    if (size <= 0) {
      return { canEnter: false, reason: 'Calculated size too small', size: 0 };
    }

    return { canEnter: true, size };
  }

  get leverage(): number { return this.defaultLeverage; }

  incrementPosition(): void { this.totalPositions++; }
  decrementPosition(): void { this.totalPositions = Math.max(0, this.totalPositions - 1); }
  get totalOpen(): number { return this.totalPositions; }
}
