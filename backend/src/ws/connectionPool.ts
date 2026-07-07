import WebSocket from 'ws';
import { config } from '../config/index.js';

interface ShardConfig {
  maxTopicsPerConn: number;  // max topics per shard connection
  charLimit?: number;         // for Bybit: total char limit
  batchSize: number;          // topics per subscribe batch during reconnect
  batchDelayMs: number;       // delay between batches
}

interface ShardConnection {
  id: number;
  ws: WebSocket | null;
  topics: string[];
  status: 'connecting' | 'live' | 'reconnecting' | 'dead';
  lastMessage: number;
  reconnectAttempt: number;
  ready: boolean;
}

type TickerCallback = (symbol: string, price: number, funding: number, volume: number) => void;
type StatusCallback = (exchange: string, overall: string, detail: any[]) => void;

interface ExchangeShardConfig {
  name: string;
  defaultConfig: ShardConfig;
  getTopics: (symbols: string[]) => string[];
  subscribe: (ws: WebSocket, topics: string[]) => void;
  handleMessage: (msg: any, topics: string[], onTicker: TickerCallback, exchange: string) => void;
  pingIntervalMs: number;
  pingTimeoutMs: number;
  sendPing: (ws: WebSocket) => void;
  isPong: (msg: any) => boolean;
  getBulletToken?: () => Promise<{ endpoint: string; token: string; pingInterval: number; pingTimeout: number } | null>;
}

export class ConnectionPoolManager {
  private shards: ShardConnection[] = [];
  private exchangeConfig: ExchangeShardConfig;
  private onTicker: TickerCallback | null = null;
  private onStatus: StatusCallback | null = null;
  private running = false;
  private currentSymbols: string[] = [];
  private actualMaxPerConn: number;
  private poolName: string;
  private pingTimers: Map<number, ReturnType<typeof setInterval>> = new Map();
  private bulletToken: { endpoint: string; token: string; pingInterval: number; pingTimeout: number } | null = null;
  private bulletTokenTimer: ReturnType<typeof setTimeout> | null = null;
  private kuCoinRateLimitTokens = 10; // KuCoin: max 100 messages per 10s
  private kuCoinMsgTimestamps: number[] = [];

  constructor(
    private exchange: string,
    shardConfig: ExchangeShardConfig,
  ) {
    this.exchangeConfig = shardConfig;
    this.actualMaxPerConn = shardConfig.defaultConfig.maxTopicsPerConn;
    this.poolName = exchange;
  }

  onTickerCb(cb: TickerCallback): void { this.onTicker = cb; }
  onStatusCb(cb: StatusCallback): void { this.onStatus = cb; }

  async init(symbols: string[]): Promise<void> {
    this.running = true;
    this.currentSymbols = symbols;
    this.shards = [];

    // For KuCoin: get bullet token first
    if (this.exchangeConfig.getBulletToken) {
      this.bulletToken = await this.exchangeConfig.getBulletToken();
    }

    this.buildShards();

    // Bullet refresh timer (KuCoin specific)
    if (this.exchange === 'kucoin' && this.exchangeConfig.getBulletToken) {
      // Refresh at hour 23 before 24h expiry
      this.bulletTokenTimer = setInterval(async () => {
        console.log(`[${this.poolName}] Refreshing bullet token`);
        this.bulletToken = await this.exchangeConfig.getBulletToken!();
      }, 23 * 60 * 60 * 1000);
    }

    console.log(`[${this.poolName}] Pool initialized: ${this.shards.length} shards, ${this.actualMaxPerConn} max/conn`);
    this.emitStatus();
  }

  updateSymbols(symbols: string[]): void {
    this.currentSymbols = symbols;
    this.buildShards();
    console.log(`[${this.poolName}] Symbols updated: ${symbols.length}, ${this.shards.length} shards`);
  }

  stop(): void {
    this.running = false;
    for (const ping of this.pingTimers.values()) clearInterval(ping);
    this.pingTimers.clear();
    if (this.bulletTokenTimer) clearInterval(this.bulletTokenTimer);
    for (const shard of this.shards) {
      if (shard.ws) { try { shard.ws.close(); } catch {} }
    }
    this.shards = [];
  }

  getHealth(): any[] {
    return this.shards.map(s => ({
      id: s.id,
      status: s.status,
      topics: s.topics.length,
      lastMessage: s.lastMessage ? Math.floor((Date.now() - s.lastMessage) / 1000) + 's ago' : 'never',
      reconnectAttempts: s.reconnectAttempt,
    }));
  }

  /** Get current symbols tracked by the pool */
  getSymbols(): string[] {
    return [...this.currentSymbols];
  }

  private buildShards(): void {
    const topics = this.exchangeConfig.getTopics(this.currentSymbols);
    const symbolsPerShard = this.actualMaxPerConn;

    // Group topics into shards
    const groups: string[][] = [];
    for (let i = 0; i < topics.length; i += symbolsPerShard) {
      groups.push(topics.slice(i, i + symbolsPerShard));
    }

    // Create or reuse shards
    while (this.shards.length < groups.length) {
      const id = this.shards.length;
      this.shards.push({
        id, ws: null, topics: [], status: 'connecting',
        lastMessage: Date.now(), reconnectAttempt: 0, ready: false,
      });
    }

    // Remove excess shards
    while (this.shards.length > groups.length) {
      const shard = this.shards.pop()!;
      if (shard.ws) { try { shard.ws.close(); } catch {} }
      const pingTimer = this.pingTimers.get(shard.id);
      if (pingTimer) { clearInterval(pingTimer); this.pingTimers.delete(shard.id); }
    }

    // Update topics and reconnect if needed
    for (let i = 0; i < groups.length; i++) {
      const shard = this.shards[i];
      const newTopics = groups[i];

      if (JSON.stringify(shard.topics) !== JSON.stringify(newTopics)) {
        shard.topics = newTopics;
        this.connectShard(shard);
      }
    }
  }

  private async connectShard(shard: ShardConnection): Promise<void> {
    if (!this.running) return;

    const wsUrl = this.getWsUrl();
    if (!wsUrl) return;

    shard.status = 'connecting';
    if (shard.ws) { try { shard.ws.close(); } catch {} }

    const ws = new WebSocket(wsUrl);
    shard.ws = ws;
    shard.ready = false;

    ws.on('open', () => {
      console.log(`[${this.poolName}] Shard ${shard.id} connected (${shard.topics.length} topics)`);
      shard.status = 'live';
      shard.reconnectAttempt = 0;
      shard.lastMessage = Date.now();

      // Subscribe topics in batches
      this.subscribeBatch(shard);
      this.startPing(shard);
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        shard.lastMessage = Date.now();

        // Pong
        if (this.exchangeConfig.isPong(msg)) return;

        // Ticker data
        this.exchangeConfig.handleMessage(msg, shard.topics, this.onTicker || (() => {}), this.exchange);
      } catch {}
    });

    ws.on('close', () => {
      console.log(`[${this.poolName}] Shard ${shard.id} closed`);
      this.stopPing(shard);
      shard.status = 'reconnecting';
      this.emitStatus();
      this.reconnectShard(shard);
    });

    ws.on('error', () => {});

    this.emitStatus();
  }

  private subscribeBatch(shard: ShardConnection): void {
    if (!shard.ws || shard.ws.readyState !== WebSocket.OPEN) return;

    const { batchSize, batchDelayMs } = this.exchangeConfig.defaultConfig;

    const subInBatches = (start: number) => {
      if (start >= shard.topics.length) {
        shard.ready = true;
        this.emitStatus();
        return;
      }

      const batch = shard.topics.slice(start, start + batchSize);
      this.exchangeConfig.subscribe(shard.ws!, batch);
      this.rateLimitWait();

      setTimeout(() => subInBatches(start + batchSize), batchDelayMs);
    };

    subInBatches(0);
  }

  private async reconnectShard(shard: ShardConnection): Promise<void> {
    if (!this.running) return;

    const baseDelay = 1000 * Math.min(Math.pow(2, shard.reconnectAttempt), 30);
    const jitter = Math.random() * 1000;
    const delay = baseDelay + jitter;

    shard.reconnectAttempt++;
    console.log(`[${this.poolName}] Shard ${shard.id} reconnect in ${Math.round(delay)}ms (attempt ${shard.reconnectAttempt})`);

    await new Promise(r => setTimeout(r, delay));
    this.connectShard(shard);
  }

  private startPing(shard: ShardConnection): void {
    this.stopPing(shard);
    const timer = setInterval(() => {
      if (shard.ws?.readyState === WebSocket.OPEN) {
        this.exchangeConfig.sendPing(shard.ws);
        // Check staleness
        if (Date.now() - shard.lastMessage > this.exchangeConfig.pingTimeoutMs) {
          console.warn(`[${this.poolName}] Shard ${shard.id} stale, reconnecting`);
          shard.status = 'reconnecting';
          if (shard.ws) { try { shard.ws.close(); } catch {} }
        }
      }
    }, this.exchangeConfig.pingIntervalMs);
    this.pingTimers.set(shard.id, timer);
  }

  private stopPing(shard: ShardConnection): void {
    const timer = this.pingTimers.get(shard.id);
    if (timer) { clearInterval(timer); this.pingTimers.delete(shard.id); }
  }

  private getWsUrl(): string | null {
    if (this.exchange === 'bybit') return config.bybit.wsUrl;
    if (this.exchange === 'kucoin') {
      if (this.bulletToken) {
        return `${this.bulletToken.endpoint}?token=${this.bulletToken.token}`;
      }
      return null;
    }
    return null;
  }

  private emitStatus(): void {
    if (!this.onStatus) return;
    const detail = this.shards.map(s => ({ id: s.id, status: s.status, topics: s.topics.length, ready: s.ready }));
    const liveCount = detail.filter(d => d.status === 'live').length;
    const overall = liveCount === this.shards.length ? 'live' : liveCount > 0 ? 'degraded' : 'down';
    this.onStatus(this.exchange, overall, detail);
  }

  private rateLimitWait(): void {
    if (this.exchange !== 'kucoin') return;
    this.kuCoinMsgTimestamps.push(Date.now());
    // Keep last 10 seconds
    this.kuCoinMsgTimestamps = this.kuCoinMsgTimestamps.filter(t => Date.now() - t < 10000);
    if (this.kuCoinMsgTimestamps.length >= 90) {
      // Close to limit (100 per 10s), wait a bit
      const waitMs = 200;
      this.kuCoinMsgTimestamps.splice(0, 10); // clear some
    }
  }
}

// ---- Bybit shard config ----
export function createBybitPool(): ConnectionPoolManager {
  const bybit: ExchangeShardConfig = {
    name: 'bybit',
    defaultConfig: { maxTopicsPerConn: 200, charLimit: 21000, batchSize: 50, batchDelayMs: 200 },
    getTopics: (symbols) => symbols.map(s => `tickers.${s}`),
    subscribe: (ws, topics) => {
      ws.send(JSON.stringify({ op: 'subscribe', args: topics }));
    },
    handleMessage: (msg, _topics, onTicker) => {
      if ((msg.type === 'snapshot' || msg.type === 'delta') && msg.topic?.startsWith('tickers.')) {
        const sym = msg.topic.replace('tickers.', '');
        const d = msg.data;
        if (!d) return;
        onTicker(sym, parseFloat(d.markPrice) || 0, parseFloat(d.fundingRate) || 0, parseFloat(d.volume24h) || 0);
      }
    },
    pingIntervalMs: 15000,
    pingTimeoutMs: 30000,
    sendPing: (ws) => ws.send(JSON.stringify({ op: 'ping' })),
    isPong: (msg) => msg.op === 'pong',
  };
  return new ConnectionPoolManager('bybit', bybit);
}

// ---- KuCoin shard config ----
export function createKucoinPool(): ConnectionPoolManager {
  const kucoin: ExchangeShardConfig = {
    name: 'kucoin',
    defaultConfig: { maxTopicsPerConn: 80, batchSize: 20, batchDelayMs: 500 },
    getTopics: (symbols) => symbols.map(s => `/contractMarket/tickerV2:${s}`),
    subscribe: (ws, topics) => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        topic: topics.join(','),
        privateChannel: false, response: true,
      }));
    },
    handleMessage: (msg, _topics, onTicker) => {
      if (msg.type === 'message' && msg.topic?.startsWith('/contractMarket/tickerV2:')) {
        const rawSym = msg.topic.split(':')[1];
        const d = msg.data;
        if (!d) return;
        // KuCoin tickerV2 uses bestBidPrice, not "price"
        const price = parseFloat(d.bestBidPrice || d.price || '0');
        onTicker(rawSym, price, 0, 0);
      }
      // Also handle instrument for funding rate + mark price
      if (msg.type === 'message' && msg.topic?.startsWith('/contract/instrument:')) {
        const rawSym = msg.topic.split(':')[1];
        const d = msg.data;
        if (!d) return;
        // Instrument can have markPrice AND fundingRate
        const markPrice = parseFloat(d.markPrice || '0');
        const fundingRate = parseFloat(d.fundingRate || '0');
        if (markPrice > 0 || fundingRate !== 0) {
          onTicker(rawSym, markPrice, fundingRate, 0);
        }
      }
    },
    pingIntervalMs: 9000,
    pingTimeoutMs: 20000,
    sendPing: (ws) => ws.send(JSON.stringify({ id: String(Date.now()), type: 'ping' })),
    isPong: (msg) => msg.type === 'pong',
    getBulletToken: async () => {
      try {
        const res = await fetch('https://api-futures.kucoin.com/api/v1/bullet-public', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const json = await res.json() as any;
        if (json.code !== '200000') return null;
        const svr = json.data.instanceServers[0];
        return {
          endpoint: svr.endpoint, token: json.data.token,
          pingInterval: svr.pingInterval, pingTimeout: svr.pingTimeout,
        };
      } catch { return null; }
    },
  };
  return new ConnectionPoolManager('kucoin', kucoin);
}
