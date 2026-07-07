import { config } from '../config/index.js';
import { getByBybit, getByKucoin, getStandardSymbols } from './symbolMapper.js';

interface PairInfo {
  standard: string;
  bybit: string;
  kucoin: string;
  base: string;
  bybitStatus: string;
  kucoinStatus: string;
}

type DiscoveryCallback = (newPairs: string[], removedPairs: string[]) => void;

/**
 * Auto-discovers all trading pairs available on both Bybit & KuCoin.
 * Runs on startup and periodically to catch listings/delistings.
 */
export class PairDiscovery {
  private currentSymbols: string[] = [];
  private callbacks: DiscoveryCallback[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;

  onSymbolsChange(cb: DiscoveryCallback): void {
    this.callbacks.push(cb);
  }

  get symbols(): string[] {
    return [...this.currentSymbols];
  }

  async start(): Promise<void> {
    await this.discover();
    // Re-discover every hour
    this.interval = setInterval(() => this.discover(), 60 * 60 * 1000);
    console.log('[Discovery] Started (hourly refresh)');
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  async discover(): Promise<string[]> {
    try {
      const [bybitSymbols, kucoinSymbols] = await Promise.all([
        this.fetchBybitSymbols(),
        this.fetchKucoinSymbols(),
      ]);

      // Build standard name set for quick lookup
      const standardSet = new Set(getStandardSymbols());

      // Match pairs: find overlap between bybit and kucoin base currencies
      const bybitBaseMap = new Map<string, string>();
      for (const sym of bybitSymbols) {
        const base = sym.replace(/USDT$/, '');
        bybitBaseMap.set(base, sym);
      }

      const kucoinBaseMap = new Map<string, string>();
      for (const sym of kucoinSymbols) {
        const base = sym.replace(/USDTM$/, '');
        kucoinBaseMap.set(base, sym);
      }

      const matchedPairs: string[] = [];
      for (const [base, bybitSym] of bybitBaseMap) {
        const kucoinSym = kucoinBaseMap.get(base);
        if (kucoinSym) {
          const standard = `${base}USDT`;
          if (!standardSet.has(standard)) {
            console.log(`[Discovery] New pair: ${standard} (${bybitSym} / ${kucoinSym})`);
          }
          matchedPairs.push(standard);
        }
      }

      // Find new & removed
      const oldSet = new Set(this.currentSymbols);
      const newPairs = matchedPairs.filter(s => !oldSet.has(s));
      const removedPairs = this.currentSymbols.filter(s => !matchedPairs.includes(s));

      this.currentSymbols = matchedPairs;

      if (newPairs.length > 0 || removedPairs.length > 0) {
        console.log(`[Discovery] ${matchedPairs.length} pairs matched (+${newPairs.length}/-${removedPairs.length})`);
        for (const cb of this.callbacks) cb(newPairs, removedPairs);
      }

      return matchedPairs;
    } catch (err) {
      console.error('[Discovery] Error:', err);
      return this.currentSymbols;
    }
  }

  private async fetchBybitSymbols(): Promise<string[]> {
    const res = await fetch(`${config.bybit.restUrl}/v5/market/instruments-info?category=linear&limit=1000`);
    const json = await res.json() as any;
    if (!json.result?.list) return [];
    return json.result.list
      .filter((i: any) => i.quoteCoin === 'USDT' && i.status === 'Trading' && i.symbol.endsWith('USDT'))
      .map((i: any) => i.symbol);
  }

  private async fetchKucoinSymbols(): Promise<string[]> {
    const res = await fetch(`${config.kucoin.restUrl}/api/v1/contracts/active`);
    const json = await res.json() as any;
    if (json.code !== '200000' || !json.data) return [];
    return json.data
      .filter((i: any) => i.status === 'Open' && i.symbol.endsWith('USDTM') && i.quoteCurrency === 'USDT')
      .map((i: any) => i.symbol);
  }
}
