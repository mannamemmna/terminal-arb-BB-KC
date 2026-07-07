/** Unified ticker data from any exchange */
export interface TickerData {
  symbol: string;          // internal standard name
  markPrice: number;
  indexPrice?: number;
  fundingRate: number;
  volume24h: number;
  timestamp: number;
}

/** Exchange connection status */
export type ConnectionStatus = 'connecting' | 'live' | 'degraded' | 'down';

/** Exchange connector interface */
export interface ExchangeConnector {
  readonly name: string;
  status: ConnectionStatus;
  start(): Promise<void>;
  stop(): void;
  onTicker(cb: (data: TickerData) => void): void;
  onStatusChange(cb: (status: ConnectionStatus) => void): void;
  fetchAllTickers(): Promise<TickerData[]>;
  fetchAvailableSymbols(): Promise<string[]>;
}

/** Spread calculation result — shape MATCHES Phase 1 dummy data */
export interface SpreadResult {
  symbol: string;
  bybitPrice: number;
  kucoinPrice: number;
  spreadPct: number;
  spreadPrice: number;
  fundingBybit: number;
  fundingKucoin: number;
  fundingDiff: number;
  volume24h: number;
  verdict: 'SAFE' | 'WATCH' | 'SKIP';
  timestamp: number;
}

/** Signal log entry */
export interface SignalLog {
  timestamp: Date;
  message: string;
}

/** WS event types sent to frontend */
export type WsEvent =
  | { type: 'spread:update'; data: SpreadResult }
  | { type: 'spread:batch'; data: SpreadResult[] }
  | { type: 'signal:log'; data: SignalLog }
  | { type: 'connection:status'; data: { bybit: ConnectionStatus; kucoin: ConnectionStatus } }
  | { type: 'prices:snapshot'; data: { standard: string; bybit: number; kucoin: number }[] };
