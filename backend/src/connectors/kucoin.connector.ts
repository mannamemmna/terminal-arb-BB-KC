import WebSocket from 'ws';
import { config } from '../config/index.js';
import { getByKucoin, getStandardSymbols } from '../engine/symbolMapper.js';
import type { ExchangeConnector, TickerData, ConnectionStatus } from './types.js';

type TickerCallback = (data: TickerData) => void;
type StatusCallback = (status: ConnectionStatus) => void;

export class KucoinConnector implements ExchangeConnector {
  readonly name = 'kucoin';
  status: ConnectionStatus = 'degraded';

  private tickerCb: TickerCallback | null = null;
  private statusCb: StatusCallback | null = null;
  private restPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastUpdate = 0;

  // WS (secondary / bonus)
  private ws: WebSocket | null = null;
  private shouldReconnect = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  onTicker(cb: TickerCallback): void { this.tickerCb = cb; }
  onStatusChange(cb: StatusCallback): void { this.statusCb = cb; }

  async start(): Promise<void> {
    this.shouldReconnect = true;
    // REST as primary source for KuCoin
    this.startRestPolling();
    this.wsConnect().catch(() => {});
  }

  stop(): void {
    this.shouldReconnect = false;
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.restPollTimer) { clearInterval(this.restPollTimer); this.restPollTimer = null; }
  }

  // ---- WS (bonus, not critical) ----
  private async wsConnect(): Promise<void> {
    try {
      const bulletRes = await fetch('https://api-futures.kucoin.com/api/v1/bullet-public', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      const bullet = await bulletRes.json() as any;
      if (bullet.code !== '200000' || !bullet.data?.instanceServers?.length) return;

      const svr = bullet.data.instanceServers[0];
      const url = `${svr.endpoint}?token=${bullet.data.token}`;

      this.ws = new WebSocket(url);
      this.ws.on('open', () => {
        console.log('[KuCoin WS] connected');
        this.reconnectAttempt = 0;
        const symbols = getStandardSymbols().map(s => {
          const info = getByKucoin(s);
          return info ? info.kucoin : s;
        }).join(',');
        this.ws!.send(JSON.stringify({ type: 'subscribe', topic: `/contractMarket/tickerV2:${symbols}`, privateChannel: false, response: true }));
        this.ws!.send(JSON.stringify({ type: 'subscribe', topic: `/contract/instrument:${symbols}`, privateChannel: false, response: true }));
        this.startWsPing();
      });
      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'message' && msg.data) {
            const topic = msg.topic as string;
            if (topic.startsWith('/contractMarket/tickerV2:')) {
              const rawSym = topic.split(':')[1];
              const info = getByKucoin(rawSym);
              if (info && this.tickerCb) {
                this.tickerCb({
                  symbol: info.standard,
                  markPrice: parseFloat(msg.data.price) || 0,
                  fundingRate: 0,
                  volume24h: parseFloat(msg.data.vol) || 0,
                  timestamp: Date.now(),
                });
              }
            }
          }
        } catch {}
      });
      this.ws.on('close', () => { this.stopWsPing(); if (this.shouldReconnect) this.wsReconnect(); });
      this.ws.on('error', () => {});
    } catch {}
  }

  private startWsPing(): void {
    this.stopWsPing();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ id: String(Date.now()), type: 'ping' }));
    }, 15_000);
  }
  private stopWsPing(): void { if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; } }
  private wsReconnect(): void {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30000);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.wsConnect(), delay);
  }

  // ---- REST primary ----
  startRestPolling(): void {
    this.restPollTimer = setInterval(async () => {
      try {
        const tickers = await this.fetchAllTickers();
        if (tickers.length > 0 && this.tickerCb) {
          for (const t of tickers) this.tickerCb(t);
          this.lastUpdate = Date.now();
        }
      } catch (err) { console.error('[KuCoin] REST err:', err); this.setStatus('down'); }
    }, config.health.restPollIntervalMs);
  }

  async fetchAllTickers(): Promise<TickerData[]> {
    const res = await fetch(`${config.kucoin.restUrl}/api/v1/contracts/active`);
    const json = await res.json() as any;
    if (json.code !== '200000' || !json.data) return [];
    return json.data
      .filter((item: any) => getByKucoin(item.symbol))
      .map((item: any) => {
        const info = getByKucoin(item.symbol)!;
        return {
          symbol: info.standard,
          markPrice: parseFloat(item.markPrice) || 0,
          fundingRate: parseFloat(item.fundingFeeRate) || 0,
          volume24h: parseFloat(item.volumeOf24h) || 0,
          timestamp: Date.now(),
        };
      });
  }

  async fetchAvailableSymbols(): Promise<string[]> {
    const res = await fetch(`${config.kucoin.restUrl}/api/v1/contracts/active`);
    const json = await res.json() as any;
    if (json.code !== '200000' || !json.data) return [];
    return json.data.filter((i: any) => i.status === 'Open').map((i: any) => i.symbol);
  }

  private setStatus(s: ConnectionStatus): void { this.status = s; this.statusCb?.(s); }
}
