import * as crypto from 'node:crypto';
import type { OrderRequest, OrderResult, AccountBalance, PositionInfo } from './exchangeTrader.js';

/**
 * PaperTrader — simulates order execution in demo mode.
 * No API keys needed. Behaves identically to a real trader for the orchestrator.
 */
export class PaperTrader {
  readonly name = 'paper';
  readonly mode: 'demo' | 'live' = 'demo';

  private mockBalance = 10000;
  private openPositions: Map<string, { side: string; size: number; entryPrice: number }> = new Map();

  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    const clientOrderId = req.clientOrderId || `paper_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const start = Date.now();

    // Simulate fill at current market price (best estimate)
    const fillPrice = req.price || (req.side === 'BUY' ? 50000 : 50000); // placeholder

    return {
      orderId: `paper_${clientOrderId}`,
      clientOrderId,
      symbol: req.symbol,
      side: req.side,
      size: req.size,
      price: fillPrice,
      status: 'FILLED',
      filledSize: req.size,
      avgPrice: fillPrice,
      latencyMs: Date.now() - start,
    };
  }

  async closePosition(symbol: string): Promise<OrderResult[]> {
    const results: OrderResult[] = [];
    const pos = this.openPositions.get(symbol);
    if (pos) {
      const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
      results.push({
        orderId: `paper_close_${Date.now()}`,
        symbol, side: closeSide as 'BUY' | 'SELL',
        size: pos.size, price: pos.entryPrice,
        status: 'FILLED', filledSize: pos.size, avgPrice: pos.entryPrice,
        latencyMs: 10,
      });
      this.openPositions.delete(symbol);
    }
    return results;
  }

  async getOpenPositions(): Promise<PositionInfo[]> {
    return Array.from(this.openPositions.entries()).map(([symbol, p]) => ({
      symbol,
      side: p.side as 'LONG' | 'SHORT',
      size: p.size,
      entryPrice: p.entryPrice,
      markPrice: p.entryPrice,
      unrealizedPnl: 0,
      leverage: 1,
    }));
  }

  async getBalance(): Promise<AccountBalance> {
    return {
      exchange: 'paper',
      totalEquity: this.mockBalance,
      availableBalance: this.mockBalance,
      usedMargin: 0,
      unrealizedPnl: 0,
      currency: 'USDT',
    };
  }

  async setLeverage(_symbol: string, _leverage: number): Promise<void> {
    // Paper mode — no-op
  }
}
