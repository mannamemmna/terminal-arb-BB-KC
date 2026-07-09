import * as crypto from 'node:crypto';
import type { BybitTrader } from '../connectors/bybit.trader.js';
import type { KucoinTrader } from '../connectors/kucoin.trader.js';
import type { PositionManager } from './positionManager.js';
import type { SpreadCalculator } from './spreadCalculator.js';
import type { SpreadResult } from '../connectors/types.js';
import prisma from '../db/client.js';

type LogFn = (msg: string) => void;

/**
 * Executes a two-leg hedged position entry atomically.
 * Both legs are sent in PARALLEL — if one fails, the other is rolled back.
 */
export class ExecutionOrchestrator {
  private busy = new Set<string>(); // symbols being executed (prevent double-entry)

  constructor(
    private bybit: BybitTrader,
    private kucoin: KucoinTrader,
    private positionManager: PositionManager,
    private calculator: SpreadCalculator,
    private onLog: LogFn,
  ) {}

  async tryEnter(spread: SpreadResult, mode: 'paper' | 'testnet' | 'live'): Promise<boolean> {
    const sym = spread.symbol;
    if (this.busy.has(sym)) return false;
    this.busy.add(sym);

    try {
      // Check sizing
      const sizing = await this.positionManager.canEnter(sym, spread.bybitPrice);
      if (!sizing.canEnter) {
        this.onLog(`[SKIP] ${sym}: ${sizing.reason}`);
        return false;
      }

      const size = sizing.size;
      const leverage = this.positionManager.leverage;

      // Determine sides
      const bybitSide = spread.fundingDiff > 0 ? 'BUY' as const : 'SELL' as const;
      const kucoinSide = spread.fundingDiff > 0 ? 'SELL' as const : 'BUY' as const;
      const bybitPosSide = spread.fundingDiff > 0 ? 'LONG' : 'SHORT';
      const kucoinPosSide = spread.fundingDiff > 0 ? 'SHORT' : 'LONG';

      // Set leverage on both exchanges
      await Promise.all([
        this.bybit.setLeverage(sym, leverage).catch(() => {}),
        this.kucoin.setLeverage(sym, leverage).catch(() => {}),
      ]);

      this.onLog(`[ENTRY] ${sym}: ${bybitPosSide} Bybit / ${kucoinPosSide} KuCoin | Size ${size} | Leverage ${leverage}x`);

      // Execute BOTH legs in PARALLEL
      const [bybitResult, kucoinResult] = await Promise.all([
        this.bybit.placeOrder({ symbol: sym, side: bybitSide, orderType: 'MARKET', size }),
        this.kucoin.placeOrder({ symbol: sym, side: kucoinSide, orderType: 'MARKET', size }),
      ]);

      // Log individual orders
      await this.saveOrder(null, 'bybit', sym, bybitSide, size, bybitResult);
      await this.saveOrder(null, 'kucoin', sym, kucoinSide, size, kucoinResult);

      // If either leg failed → rollback the successful one
      const bybitOk = bybitResult.status === 'FILLED';
      const kucoinOk = kucoinResult.status === 'FILLED';

      if (!bybitOk && !kucoinOk) {
        this.onLog(`[FAIL] ${sym}: Both legs rejected — ${bybitResult.errorMessage} / ${kucoinResult.errorMessage}`);
        return false;
      }

      if (!bybitOk && kucoinOk) {
        this.onLog(`[ROLLBACK] ${sym}: Bybit failed (${bybitResult.errorMessage}), closing KuCoin leg`);
        await this.kucoin.closePosition(sym);
        await this.saveOrder(null, 'kucoin', sym, kucoinSide === 'BUY' ? 'SELL' : 'BUY', size, { orderId: 'rollback', status: 'FILLED' } as any);
        return false;
      }

      if (bybitOk && !kucoinOk) {
        this.onLog(`[ROLLBACK] ${sym}: KuCoin failed (${kucoinResult.errorMessage}), closing Bybit leg`);
        await this.bybit.closePosition(sym);
        await this.saveOrder(null, 'bybit', sym, bybitSide === 'BUY' ? 'SELL' : 'BUY', size, { orderId: 'rollback', status: 'FILLED' } as any);
        return false;
      }

      // Both legs filled → save position
      const entryPriceBybit = bybitResult.avgPrice || spread.bybitPrice;
      const entryPriceKucoin = kucoinResult.avgPrice || spread.kucoinPrice;

      const position = await prisma.position.create({
        data: {
          symbol: sym, mode,
          legASide: bybitPosSide, legAEntryPrice: entryPriceBybit, legASize: size, legAOrderId: bybitResult.orderId,
          legBSide: kucoinPosSide, legBEntryPrice: entryPriceKucoin, legBSize: size, legBOrderId: kucoinResult.orderId,
          size, entrySpread: spread.spreadPct,
          status: 'OPEN',
        },
      });

      this.positionManager.incrementPosition();
      this.onLog(`[OPEN] ${sym}: Position ${position.id} opened`);

      // Save to trades table too
      await prisma.trade.create({
        data: {
          symbol: sym, sideBybit: bybitPosSide, sideKucoin: kucoinPosSide,
          entrySpread: spread.spreadPct, status: 'OPEN',
        },
      });

      return true;
    } catch (err: any) {
      this.onLog(`[ERROR] ${sym}: ${err.message}`);
      return false;
    } finally {
      this.busy.delete(sym);
    }
  }

  async closePosition(positionId: string): Promise<boolean> {
    const pos = await prisma.position.findUnique({ where: { id: positionId } });
    if (!pos || pos.status !== 'OPEN') return false;

    const sym = pos.symbol;
    this.onLog(`[EXIT] ${sym}: Closing position ${positionId}`);

    const [bybitRes, kucoinRes] = await Promise.all([
      this.bybit.closePosition(sym),
      this.kucoin.closePosition(sym),
    ]);

    // Calculate realized PnL
    const spreadSnap = this.calculator.compute(sym);
    const exitSpread = spreadSnap?.spreadPct || pos.entrySpread;
    const realizedPnl = pos.size * (pos.entrySpread - exitSpread) * 10; // simplified PnL calc

    await prisma.position.update({
      where: { id: positionId },
      data: { status: 'CLOSED', closedAt: new Date(), currentSpread: exitSpread, realizedPnl },
    });

    await prisma.trade.updateMany({
      where: { symbol: sym, status: 'OPEN' },
      data: { status: 'CLOSED', exitSpread, pnl: realizedPnl, closedAt: new Date() },
    });

    this.positionManager.decrementPosition();
    this.onLog(`[CLOSE] ${sym}: PnL $${realizedPnl.toFixed(2)}`);
    return true;
  }

  async closeAllPositions(): Promise<void> {
    const positions = await prisma.position.findMany({ where: { status: 'OPEN' } });
    for (const pos of positions) {
      await this.closePosition(pos.id);
    }
    this.onLog(`[KILL] All ${positions.length} positions closed`);
  }

  async getOpenPositions() {
    return prisma.position.findMany({ where: { status: 'OPEN' } });
  }

  private async saveOrder(positionId: string | null, exchange: string, symbol: string, side: string, size: number, result: any): Promise<void> {
    await prisma.order.create({
      data: {
        positionId, exchange, symbol, side, orderType: 'MARKET', size,
        clientOrderId: result.clientOrderId,
        requestPayload: JSON.stringify({ symbol, side, size }),
        responseRaw: JSON.stringify(result),
        status: result.status || 'ERROR',
        latencyMs: result.latencyMs || 0,
        errorMessage: result.errorMessage,
      },
    });
  }
}
