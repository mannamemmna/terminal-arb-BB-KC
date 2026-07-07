import type { TickerData } from './types.js';

export interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  size: number;
  price?: number;
  reduceOnly?: boolean;
  clientOrderId?: string;
}

export interface OrderResult {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: string;
  size: number;
  price: number;
  status: 'FILLED' | 'PARTIAL' | 'REJECTED' | 'ERROR';
  filledSize?: number;
  avgPrice?: number;
  errorMessage?: string;
  latencyMs?: number;
}

export interface AccountBalance {
  exchange: string;
  totalEquity: number;
  availableBalance: number;
  usedMargin: number;
  unrealizedPnl: number;
  currency: string;
}

export interface PositionInfo {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
}

/**
 * Trader interface — each exchange implements this for order execution.
 */
export interface ExchangeTrader {
  readonly name: string;
  readonly mode: 'demo' | 'live';

  /** Place an order */
  placeOrder(req: OrderRequest): Promise<OrderResult>;

  /** Close all positions for a symbol */
  closePosition(symbol: string): Promise<OrderResult[]>;

  /** Get all open positions */
  getOpenPositions(): Promise<PositionInfo[]>;

  /** Get account balance */
  getBalance(): Promise<AccountBalance>;

  /** Set leverage for a symbol */
  setLeverage(symbol: string, leverage: number): Promise<void>;
}
