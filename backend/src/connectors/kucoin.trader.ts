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
  mode: 'paper' | 'testnet' | 'live' = 'paper';

  private apiKey = '';
  private apiSecret = '';
  private apiPassphrase = '';
  private baseUrl = '';

  constructor(mode: 'paper' | 'testnet' | 'live') {
    this.reconfigure(mode);
  }

  reconfigure(mode: 'paper' | 'testnet' | 'live'): void {
    this.mode = mode;
    if (mode === 'testnet') {
      this.apiKey = process.env.KUCOIN_DEMO_API_KEY || '';
      this.apiSecret = process.env.KUCOIN_DEMO_API_SECRET || '';
      this.apiPassphrase = process.env.KUCOIN_DEMO_API_PASSPHRASE || '';
      this.baseUrl = 'https://api-sandbox-futures.kucoin.com';
    } else if (mode === 'live') {
      this.apiKey = process.env.KUCOIN_LIVE_API_KEY || '';
      this.apiSecret = process.env.KUCOIN_LIVE_API_SECRET || '';
      this.apiPassphrase = process.env.KUCOIN_LIVE_API_PASSPHRASE || '';
      this.baseUrl = config.kucoin.restUrl;
    } else {
      this.apiKey = '';
      this.apiSecret = '';
      this.apiPassphrase = '';
      this.baseUrl = '';
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
    if (this.mode !== 'paper' && !this.apiKey) {
      return { code: '400', msg: `${this.mode} API key not configured` };
    }
    if (this.mode === 'paper') return { code: '-1', msg: 'Paper mode — no exchange calls' };
    try {
      const hdrs = this.headers(method, path, body);
      const res = await fetch(`${this.baseUrl}${path}`, { method, headers: hdrs, body: body ? JSON.stringify(body) : undefined });
      return res.json();
    } catch (err: any) {
      return { code: '-1', msg: err.message };
    }
  }

  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    if (this.mode === 'paper') {
      const clientOrderId = req.clientOrderId || `paper_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      return { orderId: `paper_${clientOrderId}`, clientOrderId, symbol: req.symbol, side: req.side, size: req.size, price: req.price || 50000, status: 'FILLED', filledSize: req.size, avgPrice: req.price || 50000, latencyMs: 5 };
    }
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
    if (this.mode === 'paper') return [];
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
    if (this.mode === 'paper') {
      return { exchange: 'kucoin', totalEquity: 0, availableBalance: 0, usedMargin: 0, unrealizedPnl: 0, currency: 'USDT' };
    }
    const res = await this.request('GET', '/api/v1/account-overview?currency=USDT');
    if (res.code !== '200000' || !res.data) {
      return { exchange: 'kucoin', totalEquity: 0, availableBalance: 0, usedMargin: 0, unrealizedPnl: 0, currency: 'USDT' };
    }
    return { exchange: 'kucoin', totalEquity: parseFloat(res.data.accountEquity) || 0, availableBalance: parseFloat(res.data.availableBalance) || 0, usedMargin: parseFloat(res.data.orderMargin) || 0, unrealizedPnl: parseFloat(res.data.unrealisedPnl) || 0, currency: 'USDT' };
  }

  async setLeverage(_symbol: string, _leverage: number): Promise<void> {
    if (this.mode === 'paper') return;
    await this.request('POST', '/api/v1/position/leverage', { symbol: _symbol, leverage: String(_leverage) });
  }
}