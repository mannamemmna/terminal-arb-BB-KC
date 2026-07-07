import WebSocket from 'ws';
import { config } from '../config/index.js';
import { getByBybit, getStandardSymbols } from '../engine/symbolMapper.js';
import type { ExchangeConnector, TickerData, ConnectionStatus } from './types.js';

type TickerCallback = (data: TickerData) => void;
type StatusCallback = (status: ConnectionStatus) => void;

export class BybitConnector implements ExchangeConnector {
  readonly name = 'bybit';
  status: ConnectionStatus = 'connecting';

  private ws: WebSocket | null = null;
  private tickerCb: TickerCallback | null = null;
  private statusCb: StatusCallback | null = null;
  private shouldReconnect = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private restPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = Date.now();
  private lastUpdate = 0;
  private subscribedSymbols: string[] = [];

  onTicker(cb: TickerCallback): void { this.tickerCb = cb; }
  onStatusChange(cb: StatusCallback): void { this.statusCb = cb; }

  async start(): Promise<void> {
    this.shouldReconnect = true;
    this.subscribedSymbols = getStandardSymbols();
    this.connectWs();
    this.startRestPolling();
  }

  stop(): void {
    this.shouldReconnect = false;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.restPollTimer) { clearInterval(this.restPollTimer); this.restPollTimer = null; }
  }

  private connectWs(): void {
    if (this.ws) { try { this.ws.close(); } catch {} }
    console.log(`[Bybit] WS connect attempt ${this.reconnectAttempt + 1}`);
    this.ws = new WebSocket(config.bybit.wsUrl);
    this.ws.on('open', () => {
      console.log('[Bybit] WS connected');
      this.reconnectAttempt = 0;
      this.setStatus('live');
      this.subscribeAll();
      this.startPing();
    });
    this.ws.on('message', (raw) => {
      try { this.handleMessage(JSON.parse(raw.toString())); }
      catch (err) { console.error('[Bybit] Parse error:', err); }
    });
    this.ws.on('close', () => {
      console.log('[Bybit] WS closed');
      this.setStatus('connecting');
      this.stopPing();
      this.scheduleReconnect();
    });
    this.ws.on('error', (err) => console.error(`[Bybit] WS err: ${err.message}`));
  }

  private subscribeAll(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const args = this.subscribedSymbols.map(s => {
      const info = getByBybit(s);
      return info ? `tickers.${info.bybit}` : `tickers.${s}`;
    });
    this.ws.send(JSON.stringify({ op: 'subscribe', args }));
    console.log(`[Bybit] Subscribed ${args.length} tickers`);
  }

  private handleMessage(msg: any): void {
    if (msg.op === 'pong') { this.lastPong = Date.now(); return; }
    if (msg.op === 'subscribe') {
      if (msg.success === false) console.warn('[Bybit] Sub fail:', msg);
      return;
    }
    if ((msg.type === 'snapshot' || msg.type === 'delta') && msg.topic?.startsWith('tickers.')) {
      const topicSym = msg.topic.replace('tickers.', '');
      const info = getByBybit(topicSym);
      if (!info || !this.tickerCb || !msg.data) return;
      this.lastUpdate = Date.now();
      this.tickerCb({
        symbol: info.standard,
        markPrice: parseFloat(msg.data.markPrice) || 0,
        indexPrice: parseFloat(msg.data.indexPrice) || 0,
        fundingRate: parseFloat(msg.data.fundingRate) || 0,
        volume24h: parseFloat(msg.data.volume24h) || 0,
        timestamp: parseInt(msg.data.timestamp) || Date.now(),
      });
    }
  }

  private startPing(): void {
    this.stopPing();
    this.lastPong = Date.now();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 'ping' }));
        if (Date.now() - this.lastPong > 30_000) { console.warn('[Bybit] No pong 30s, reconnect'); this.setStatus('connecting'); this.ws.close(); }
      }
    }, 15_000);
  }
  private stopPing(): void { if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; } }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    const delay = Math.min(config.health.wsReconnectBaseMs * Math.pow(2, this.reconnectAttempt), config.health.wsReconnectMaxMs);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.connectWs(), delay);
  }

  private setStatus(s: ConnectionStatus): void { this.status = s; this.statusCb?.(s); }

  /** Start REST polling — public so it can be used standalone without WS */
  startRestPolling(): void {
    this.restPollTimer = setInterval(async () => {
      try {
        const wsStale = Date.now() - this.lastUpdate > 15_000;
        if (wsStale && this.tickerCb) {
          if (this.status === 'live') { this.setStatus('degraded'); }
          const tickers = await this.fetchAllTickers();
          for (const t of tickers) this.tickerCb(t);
          this.lastUpdate = Date.now();
        } else if (this.status === 'degraded' && !wsStale) { this.setStatus('live'); }
      } catch (err) { console.error('[Bybit] REST err:', err); this.setStatus('down'); }
    }, config.health.restPollIntervalMs);
  }

  async fetchAllTickers(): Promise<TickerData[]> {
    const res = await fetch(`${config.bybit.restUrl}/v5/market/tickers?category=linear`);
    const json = await res.json() as any;
    if (!json.result?.list) return [];
    return json.result.list
      .filter((item: any) => getByBybit(item.symbol))
      .map((item: any) => {
        const info = getByBybit(item.symbol)!;
        return {
          symbol: info.standard,
          markPrice: parseFloat(item.markPrice) || 0,
          indexPrice: parseFloat(item.indexPrice) || 0,
          fundingRate: parseFloat(item.fundingRate) || 0,
          volume24h: parseFloat(item.volume24h) || 0,
          timestamp: parseInt(item.timestamp) || Date.now(),
        };
      });
  }

  async fetchAvailableSymbols(): Promise<string[]> {
    const res = await fetch(`${config.bybit.restUrl}/v5/market/instruments-info?category=linear`);
    const json = await res.json() as any;
    if (!json.result?.list) return [];
    return json.result.list.filter((i: any) => i.quoteCoin === 'USDT' && i.status === 'Trading').map((i: any) => i.symbol);
  }
}
