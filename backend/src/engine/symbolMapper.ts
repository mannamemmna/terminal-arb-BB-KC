/**
 * Symbol mapping: Bybit ↔ KuCoin ↔ internal standard name.
 */
export interface SymbolInfo {
  standard: string;
  bybit: string;
  kucoin: string;
  base: string;
  quote: string;
  contractSize: number;
  tickSize: number;
  minQty: number;
}

export const SYMBOL_MAP: SymbolInfo[] = [
  { standard: 'BTCUSDT',  bybit: 'BTCUSDT',  kucoin: 'XBTUSDTM', base: 'BTC',  quote: 'USDT', contractSize: 0.001, tickSize: 0.1,    minQty: 0.001 },
  { standard: 'ETHUSDT',  bybit: 'ETHUSDT',  kucoin: 'ETHUSDTM', base: 'ETH',  quote: 'USDT', contractSize: 0.01,  tickSize: 0.01,   minQty: 0.01  },
  { standard: 'SOLUSDT',  bybit: 'SOLUSDT',  kucoin: 'SOLUSDTM', base: 'SOL',  quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
  { standard: 'XRPUSDT',  bybit: 'XRPUSDT',  kucoin: 'XRPUSDTM', base: 'XRP',  quote: 'USDT', contractSize: 1,     tickSize: 0.0001, minQty: 1     },
  { standard: 'DOGEUSDT', bybit: 'DOGEUSDT', kucoin: 'DOGEUSDTM',base: 'DOGE', quote: 'USDT', contractSize: 100,   tickSize: 0.00001,minQty: 100   },
  { standard: 'ADAUSDT',  bybit: 'ADAUSDT',  kucoin: 'ADAUSDTM', base: 'ADA',  quote: 'USDT', contractSize: 1,     tickSize: 0.0001, minQty: 1     },
  { standard: 'AVAXUSDT', bybit: 'AVAXUSDT', kucoin: 'AVAXUSDTM',base: 'AVAX', quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
  { standard: 'LINKUSDT', bybit: 'LINKUSDT', kucoin: 'LINKUSDTM',base: 'LINK', quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
  { standard: 'DOTUSDT',  bybit: 'DOTUSDT',  kucoin: 'DOTUSDTM', base: 'DOT',  quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
  { standard: 'POLUSDT',  bybit: 'POLUSDT',  kucoin: 'POLUSDTM', base: 'POL',  quote: 'USDT', contractSize: 100,   tickSize: 0.00001, minQty: 1     },
  { standard: 'ATOMUSDT', bybit: 'ATOMUSDT', kucoin: 'ATOMUSDTM',base: 'ATOM', quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
  { standard: 'UNIUSDT',  bybit: 'UNIUSDT',  kucoin: 'UNIUSDTM', base: 'UNI',  quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
  { standard: 'BCHUSDT',  bybit: 'BCHUSDT',  kucoin: 'BCHUSDTM', base: 'BCH',  quote: 'USDT', contractSize: 0.01,  tickSize: 0.01,   minQty: 0.01  },
  { standard: 'LTCUSDT',  bybit: 'LTCUSDT',  kucoin: 'LTCUSDTM', base: 'LTC',  quote: 'USDT', contractSize: 0.1,   tickSize: 0.01,   minQty: 0.1   },
  { standard: 'NEARUSDT', bybit: 'NEARUSDT', kucoin: 'NEARUSDTM',base: 'NEAR', quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
  { standard: 'APTUSDT',  bybit: 'APTUSDT',  kucoin: 'APTUSDTM', base: 'APT',  quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
  { standard: 'ARBUSDT',  bybit: 'ARBUSDT',  kucoin: 'ARBUSDTM', base: 'ARB',  quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
  { standard: 'OPUSDT',   bybit: 'OPUSDT',   kucoin: 'OPUSDTM',  base: 'OP',   quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
  { standard: 'FILUSDT',  bybit: 'FILUSDT',  kucoin: 'FILUSDTM', base: 'FIL',  quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
  { standard: 'INJUSDT',  bybit: 'INJUSDT',  kucoin: 'INJUSDTM', base: 'INJ',  quote: 'USDT', contractSize: 0.1,   tickSize: 0.001,  minQty: 0.1   },
];

const bybitToS = new Map<string, SymbolInfo>();
const kucoinToS = new Map<string, SymbolInfo>();
const standardToS = new Map<string, SymbolInfo>();

for (const info of SYMBOL_MAP) {
  bybitToS.set(info.bybit, info);
  kucoinToS.set(info.kucoin, info);
  standardToS.set(info.standard, info);
}

export function getByStandard(sym: string): SymbolInfo | undefined {
  return standardToS.get(sym.toUpperCase());
}
export function getByBybit(sym: string): SymbolInfo | undefined {
  return bybitToS.get(sym);
}
export function getByKucoin(sym: string): SymbolInfo | undefined {
  return kucoinToS.get(sym);
}
export function getStandardSymbols(): string[] {
  return SYMBOL_MAP.map(s => s.standard);
}
