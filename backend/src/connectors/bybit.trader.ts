import * as crypto from 'node:crypto';
import { config } from '../config/index.js';
import type { OrderRequest, OrderResult, AccountBalance, PositionInfo } from './exchangeTrader.js';

interface BybitApiResponse {
  retCode: number;
  retMsg: string;
  result?: any;
}

export class BybitTrader {
  readonly name = 'bybit';
  readonly mode: 'demo' | 'live';

  private apiKey = '';
  private apiSecret = '';
  private baseUrl = '';

  constructor(mode: 'demo' | 'live') {
    this.mode = mode;
    if (mode === 'demo') {
      this.apiKey = process.env.BYBIT_DEMO_API_KEY || '';
      this.apiSecret = process.env.BYBIT_DEMO_API_SECRET || '';
      this.baseUrl = 'https://api-testnet.bybit.com';
    } else {
      this.apiKey = process.env.BYBIT_LIVE_API_KEY || '';
      this.apiSecret = process.env.BYBIT_LIVE_API_SECRET || '';
      this.baseUrl = config.bybit.restUrl;
    }
  }

  private sign(method: string, path: string, body: any): Record<string, string> {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const bodyStr = body ? JSON.stringify(body) : '';
    const signStr = timestamp + this.apiKey + recvWindow + bodyStr;
    const signature = crypto.createHmac('sha256', this.apiSecret).update(signStr).digest('hex');
    return {
      'X-BAPI-API-KEY': this.apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'Content-Type': 'application/json',
    };
  }

  private async request(method: string, path: string, body?: any): Promise<BybitApiResponse> {
    const url = `${this.baseUrl}${path}`;
    if (!this.apiKey) return { retCode: -1, retMsg: 'No API key configured' };
    try {
      const headers = this.sign(method, path, body);
      const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      return res.json();
    } catch (err: any) {
      return { retCode: -1, retMsg: err.message };
    }
  }

  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    const start = Date.now();
    const clientOrderId = req.clientOrderId || `arb_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    try {
      const body: Record<string, any> = {
        category: 'linear',
        symbol: req.symbol,
        side: req.side,
        orderType: req.orderType,
        qty: String(req.size),
        timeInForce: 'IOC',
        reduceOnly: req.reduceOnly || false,
        orderLinkId: clientOrderId,
      };
      if (req.price) body.price = String(req.price);

      const res = await this.request('POST', '/v5/order/create', body);
      const latency = Date.now() - start;

      if (res.retCode !== 0) {
        return { orderId: '', clientOrderId, symbol: req.symbol, side: req.side, size: req.size, price: req.price || 0, status: 'REJECTED', errorMessage: res.retMsg, latencyMs: latency };
      }

      const d = res.result;
      return {
        orderId: d.orderId || '',
        clientOrderId, symbol: req.symbol, side: req.side, size: req.size,
        price: parseFloat(d.price) || req.price || 0,
        status: d.orderStatus === 'Filled' ? 'FILLED' : 'FILLED',
        filledSize: parseFloat(d.cumExecQty) || 0,
        avgPrice: parseFloat(d.avgPrice) || 0,
        latencyMs: latency,
      };
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
    const res = await this.request('GET', '/v5/position/list?category=linear&settleCoin=USDT');
    if (res.retCode !== 0 || !res.result?.list) return [];
    return res.result.list.filter((p: any) => parseFloat(p.size) > 0).map((p: any) => ({
      symbol: p.symbol, side: p.side as 'LONG' | 'SHORT',
      size: parseFloat(p.size), entryPrice: parseFloat(p.entryPrice) || 0,
      markPrice: parseFloat(p.markPrice) || 0, unrealizedPnl: parseFloat(p.unrealisedPnl) || 0,
      leverage: parseFloat(p.leverage) || 1,
    }));
  }

  async getBalance(): Promise<AccountBalance> {
    const res = await this.request('GET', '/v5/account/wallet-balance?accountType=UNIFIED&coin=USDT');
    if (res.retCode !== 0 || !res.result?.list?.[0]) {
      return { exchange: 'bybit', totalEquity: 10000, availableBalance: 10000, usedMargin: 0, unrealizedPnl: 0, currency: 'USDT' };
    }
    const coin = res.result.list[0].coin?.[0] || {};
    return { exchange: 'bybit', totalEquity: parseFloat(coin.equity) || 0, availableBalance: parseFloat(coin.walletBalance) || 0, usedMargin: parseFloat(coin.used) || 0, unrealizedPnl: parseFloat(coin.unrealisedPnl) || 0, currency: 'USDT' };
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.request('POST', '/v5/position/set-leverage', { category: 'linear', symbol, buyLeverage: String(leverage), sellLeverage: String(leverage) });
  }
}
