import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { SpreadResult, WsEvent, ConnectionStatus } from '../connectors/types.js';

export class WsServer {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
      ws.send(JSON.stringify({ type: 'welcome', data: { message: 'Connected to Spread Arb Terminal', version: '2.0.0' } }));
    });
  }

  broadcastSpreads(spreads: SpreadResult[]): void { this.broadcast({ type: 'spread:batch', data: spreads }); }
  broadcastSpread(spread: SpreadResult): void { this.broadcast({ type: 'spread:update', data: spread }); }
  broadcastSignal(timestamp: Date, message: string): void { this.broadcast({ type: 'signal:log', data: { timestamp, message } }); }
  broadcastStatus(bybit: ConnectionStatus, kucoin: ConnectionStatus): void { this.broadcast({ type: 'connection:status', data: { bybit, kucoin } }); }

  /** Send a typed event to all connected clients */
  send(event: { type: string; data: any }): void {
    this.broadcast(event as any);
  }

  private broadcast(event: { type: string; data: any }): void {
    const msg = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) { try { ws.send(msg); } catch {} }
    }
  }

  get clientCount(): number { return this.clients.size; }
  close(): void {
    for (const ws of this.clients) try { ws.close(); } catch {}
    this.wss.close();
  }
}
