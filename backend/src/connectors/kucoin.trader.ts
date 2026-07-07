import * as crypto from 'node:crypto';
import { config } from '../config/index.js';
import type { OrderRequest, OrderResult, AccountBalance, PositionInfo } from './exchangeTrader.js';

interface KucoinApiResponse {
  code: string;
  data?: any;
  msg?: string;
}

export class KucoinTrader {
  readonly name = 'kucoin';
  readonly mode: 'demo' | 'live';

  private apiKey: string;
  private apiSecret: string;
  private apiPassphrase: string;
  private baseUrl: string;

  constructor(mode: 'demo' | 'live') {
    this.mode = mode;
    if (mode === 'demo') {
      this.apiKey = process.env.KUCOIN_DEMO_API_KEY || '';
      this.apiSecret = process.env.KUCOIN_DEMO_API_SECRET || '';
      this.apiPassphrase = process.env.KUCOIN_DEMO_API_PASSPHRASE || '';
      this.baseUrl = 'https://api-sandbox-futures.kucoin.com';
    } else {
      this.apiKey = process.env.KUCOIN_LIVE_API_KEY || '';
      this.apiSecret = process.env.KUCOIN_LIVE_API_SECRET || '';
      this.apiPassphrase = process.env.KUCOIN_LIVE_API_PASSPHRASE || '';
      this.baseUrl = config.kucoin.restUrl;
    }
  }

  private headers(method: string, path: string, body?: any): Record<string, string> {
    const now = Date.now().toString();
    const bodyStr = body ? JSON.stringify(body) : '';
    const sigPayload = now + method + path + bodyStr;
    const signature = crypto.createHmac('sha256', this.apiSecret).update(sigPayload).digest('base64');
    const passSig = crypto.createHmac('sha256', this.apiSecret).update(this.apiPassphrase).digest('base64');
    return {
      'KC-API-KEY': this.apiKey,
      'KC-API-SIGN': signature,
      'KC-API-TIMESTAMP': now,
      'KC-API-PASSPHRASE': passSig,
      'KC-API-KEY-VERSION': '3',
      'Content-Type': 'application/json',
    };
  }

  private async request(method: string, path: string, body?: any): Promise<KucoinApiResponse> {
    const url = `${this.baseUrl}${path}`;
    if (!this.apiKey) return { code: '-1', msg: 'No API key configured' };
    try {
      const hdrs = this.headers(method, path, body);
      const res = await fetch(url, { method, headers: hdrs, body: body ? JSON.stringify(body) : undefined });
      return res.json();
    } catch (err: any) {
      return { code: '-1', msg: err.message };
    }
  }

  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    const start = Date.now();
    const clientOrderId = req.clientOrderId || `arb_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    try {
      const body: Record<string, any> = {
        symbol: req.symbol,
        side: req.side === 'BUY' ? 'buy' : 'sell',
        type: req.orderType === 'MARKET' ? 'market' : 'limit',
        size: req.size,
        leverage: '1',
        clientOid: clientOrderId,
        reduceOnly: req.reduceOnly || false,
      };
      if (req.price) body.price = String(req.price);

      const res = await this.request('POST', '/api/v1/orders', body);
      const latency = Date.now() - start;

      if (res.code !== '200000') {
        return { orderId: '', clientOrderId, symbol: req.symbol, side: req.side, size: req.size, price: req.price || 0, status: 'REJECTED', errorMessage: res.msg, latencyMs: latency };
      }

      return { orderId: res.data?.orderId || '', clientOrderId, symbol: req.symbol, side: req.side, size: req.size, price: req.price || 0, status: 'FILLED', latencyMs: latency };
    } catch (err: any) {
      return { orderId: '', clientOrderId, symbol: req.symbol, side: req.side, size: req.size, price: req.price || 0, status: 'ERROR', errorMessage: err.message, latencyMs: Date.now() - start };
    }
  }

  async closePosition(symbol: string): Promise<OrderResult[]> {
    const positions = await this.getOpenPositions();
    const symPos = positions.filter(p => p.symbol === symbol);
    const results: OrderResult[] = [];
    for (const pos of symPos) {
      const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
      const r = await this.placeOrder({ symbol, side: closeSide as 'BUY' | 'SELL', orderType: 'MARKET', size: Math.abs(pos.size), reduceOnly: true });
      results.push(r);
    }
    return results;
  }

  async getOpenPositions(): Promise<PositionInfo[]> {
    const res = await this.request('GET', '/api/v1/positions');
    if (res.code !== '200000' || !Array.isArray(res.data)) return [];
    return res.data.filter((p: any) => parseFloat(p.currentQty) !== 0).map((p: any) => ({
      symbol: p.symbol, side: parseFloat(p.currentQty) > 0 ? 'LONG' : 'SHORT',
      size: Math.abs(parseFloat(p.currentQty)), entryPrice: parseFloat(p.avgEntryPrice) || 0,
      markPrice: parseFloat(p.currentMarkPrice) || 0, unrealizedPnl: parseFloat(p.unrealisedPnl) || 0,
      leverage: parseFloat(p.leverage) || 1,
    }));
  }

  async getBalance(): Promise<AccountBalance> {
    const res = await this.request('GET', '/api/v1/account-overview?currency=USDT');
    if (res.code !== '200000' || !res.data) {
      return { exchange: 'kucoin', totalEquity: 10000, availableBalance: 10000, usedMargin: 0, unrealizedPnl: 0, currency: 'USDT' };
    }
    return { exchange: 'kucoin', totalEquity: parseFloat(res.data.accountEquity) || 0, availableBalance: parseFloat(res.data.availableBalance) || 0, usedMargin: parseFloat(res.data.orderMargin) || 0, unrealizedPnl: parseFloat(res.data.unrealisedPnl) || 0, currency: 'USDT' };
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.request('POST', '/api/v1/position/leverage', { symbol, leverage: String(leverage) });
  }
}
