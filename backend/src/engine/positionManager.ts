import type { BybitTrader } from '../connectors/bybit.trader.js';
import type { KucoinTrader } from '../connectors/kucoin.trader.js';
import sectorMap from '../config/sectorMap.json' assert { type: 'json' };
import blacklist from '../config/blacklist.json' assert { type: 'json' };
const blacklistArray: string[] = blacklist;

export interface RiskConfig {
  maxConcurrentPositions: number;
  maxTotalExposurePct: number;
  maxExposurePerPairPct: number;
  maxExposurePerClusterPct: number;
  sizingMethod: 'fixed_pct' | 'volatility_adjusted';
  leverage: number;
  dailyDrawdownKillPct: number;
}

export interface SizingResult {
  canEnter: boolean;
  reason?: string;
  size: number;
}

export interface PositionState {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  notional: number;
  cluster: string;
  opportunityType: string;
}

const defaultRiskConfig: RiskConfig = {
  maxConcurrentPositions: 10,
  maxTotalExposurePct: 50,
  maxExposurePerPairPct: 10,
  maxExposurePerClusterPct: 20,
  sizingMethod: 'volatility_adjusted',
  leverage: 3,
  dailyDrawdownKillPct: 5,
};

export class PositionManager {
  private positions = new Map<string, PositionState>();
  private riskConfig: RiskConfig = { ...defaultRiskConfig };
  private dailyStartEquity = 0;
  private currentEquity = 0;

  constructor(
    private bybit: BybitTrader,
    private kucoin: KucoinTrader,
  ) {}

  async canEnter(symbol: string, entryPrice: number, opportunityType: string, volatility?: number): Promise<SizingResult> {
    // Check blacklist
    if (blacklistArray.includes(symbol)) {
      return { canEnter: false, reason: `Symbol ${symbol} is blacklisted`, size: 0 };
    }

    // Check concurrent limit
    if (this.positions.size >= this.riskConfig.maxConcurrentPositions) {
      return { canEnter: false, reason: `Max concurrent positions (${this.riskConfig.maxConcurrentPositions}) reached`, size: 0 };
    }

    // Check daily drawdown kill switch
    if (this.dailyStartEquity > 0) {
      const drawdown = (this.dailyStartEquity - this.currentEquity) / this.dailyStartEquity * 100;
      if (drawdown >= this.riskConfig.dailyDrawdownKillPct) {
        return { canEnter: false, reason: `Daily drawdown kill triggered: ${drawdown.toFixed(1)}%`, size: 0 };
      }
    }

    // Check per-pair exposure
    const existing = this.positions.get(symbol);
    if (existing) {
      return { canEnter: false, reason: `Already have position in ${symbol}`, size: 0 };
    }

    // Check total exposure
    const totalNotional = Array.from(this.positions.values()).reduce((sum, p) => sum + p.notional, 0);
    const newNotional = this.calculateNotional(entryPrice, opportunityType, volatility);
    if (totalNotional + newNotional > this.currentEquity * this.riskConfig.maxTotalExposurePct / 100) {
      return { canEnter: false, reason: `Max total exposure (${this.riskConfig.maxTotalExposurePct}%) would be exceeded`, size: 0 };
    }

    // Check per-pair exposure
    if (newNotional > this.currentEquity * this.riskConfig.maxExposurePerPairPct / 100) {
      return { canEnter: false, reason: `Max per-pair exposure (${this.riskConfig.maxExposurePerPairPct}%) would be exceeded`, size: 0 };
    }

    // Check per-cluster exposure
    const cluster = (sectorMap as Record<string, string>)[symbol] || 'OTHER';
    const clusterExposure = Array.from(this.positions.values())
      .filter(p => p.cluster === cluster)
      .reduce((sum, p) => sum + p.notional, 0);
    if (clusterExposure + newNotional > this.currentEquity * this.riskConfig.maxExposurePerClusterPct / 100) {
      return { canEnter: false, reason: `Max cluster exposure (${this.riskConfig.maxExposurePerClusterPct}% for ${cluster}) would be exceeded`, size: 0 };
    }

    // Check balance on both exchanges
    const [byBal, kucBal] = await Promise.all([this.bybit.getBalance(), this.kucoin.getBalance()]);
    if (byBal.availableBalance <= 0 || kucBal.availableBalance <= 0) {
      return { canEnter: false, reason: 'Insufficient balance on one or both exchanges', size: 0 };
    }

    const minAvail = Math.min(byBal.availableBalance, kucBal.availableBalance);
    if (newNotional > minAvail) {
      return { canEnter: false, reason: `Insufficient balance for notional ${newNotional.toFixed(2)}`, size: 0 };
    }

    return { canEnter: true, size: this.calculateSize(entryPrice, newNotional) };
  }

  private calculateNotional(entryPrice: number, opportunityType: string, volatility?: number): number {
    const baseAllocation = this.currentEquity * (this.riskConfig.maxExposurePerPairPct / 100);
    const leveraged = baseAllocation * this.riskConfig.leverage;

    if (this.riskConfig.sizingMethod === 'volatility_adjusted' && volatility) {
      // Reduce size for higher volatility
      const volFactor = Math.max(0.25, Math.min(1, 0.02 / volatility)); // Target 2% daily vol
      return leveraged * volFactor;
    }
    return leveraged;
  }

  private calculateSize(entryPrice: number, notional: number): number {
    const rawSize = notional / entryPrice;
    return Math.max(0.001, Math.round(rawSize * 1000) / 1000);
  }

  addPosition(symbol: string, side: 'LONG' | 'SHORT', size: number, entryPrice: number, opportunityType: string): void {
    const cluster = (sectorMap as Record<string, string>)[symbol] || 'OTHER';
    const notional = size * entryPrice * this.riskConfig.leverage;
    this.positions.set(symbol, { symbol, side, size, entryPrice, notional, cluster, opportunityType });
  }

  removePosition(symbol: string): void {
    this.positions.delete(symbol);
  }

  getPosition(symbol: string): PositionState | undefined {
    return this.positions.get(symbol);
  }

  getAllPositions(): PositionState[] {
    return Array.from(this.positions.values());
  }

  getClusterExposure(cluster: string): number {
    return Array.from(this.positions.values())
      .filter(p => p.cluster === cluster)
      .reduce((sum, p) => sum + p.notional, 0);
  }

  getTotalExposure(): number {
    return Array.from(this.positions.values()).reduce((sum, p) => sum + p.notional, 0);
  }

  setEquity(dailyStart: number, current: number): void {
    this.dailyStartEquity = dailyStart;
    this.currentEquity = current;
  }

  updateRiskConfig(config: Partial<RiskConfig>): void {
    this.riskConfig = { ...this.riskConfig, ...config };
  }

  getRiskConfig(): RiskConfig {
    return { ...this.riskConfig };
  }

  getLeverage(): number {
    return this.riskConfig.leverage;
  }
}