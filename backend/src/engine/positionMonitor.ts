import type { ExecutionOrchestrator } from './executionOrchestrator.js';
import type { SpreadCalculator } from './spreadCalculator.js';
import prisma from '../db/client.js';

type LogFn = (msg: string) => void;

/**
 * Background loop monitoring open positions:
 * - Updates current spread & unrealized PnL
 * - Checks exit conditions (TP, SL, max hold time)
 * - Emits position updates
 */
export class PositionMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private onPositionUpdate: ((positions: any[]) => void) | null = null;

  constructor(
    private orchestrator: ExecutionOrchestrator,
    private calculator: SpreadCalculator,
    private onLog: LogFn,
  ) {}

  onUpdate(cb: (positions: any[]) => void): void {
    this.onPositionUpdate = cb;
  }

  start(intervalMs = 5000): void {
    this.stop();
    this.interval = setInterval(() => this.tick(), intervalMs);
    console.log(`[Monitor] Started (every ${intervalMs}ms)`);
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  private async tick(): Promise<void> {
    try {
      const positions = await prisma.position.findMany({ where: { status: 'OPEN' } });
      if (positions.length === 0) return;

      const updates: any[] = [];

      for (const pos of positions) {
        const spread = this.calculator.compute(pos.symbol);
        const currentSpread = spread?.spreadPct || pos.entrySpread;
        const spreadDiff = currentSpread - pos.entrySpread;
        const unrealizedPnl = +(pos.size * spreadDiff * 10).toFixed(2);

        // Update DB
        await prisma.position.update({
          where: { id: pos.id },
          data: { currentSpread, unrealizedPnl },
        });

        updates.push({ ...pos, currentSpread, unrealizedPnl });

        // Check exit conditions
        let exitReason = '';
        if (currentSpread <= pos.entrySpread * 0.3) exitReason = 'mean_reversion';
        else if (unrealizedPnl >= pos.size * 3) exitReason = 'take_profit';
        else if (unrealizedPnl <= -(pos.size * 2)) exitReason = 'stop_loss';

        // Check max hold (30 min for demo)
        const holdMs = Date.now() - pos.openedAt.getTime();
        if (holdMs > 30 * 60 * 1000) exitReason = 'max_hold';

        if (exitReason) {
          this.onLog(`[EXIT_SIGNAL] ${pos.symbol}: ${exitReason} (spread ${currentSpread.toFixed(4)}%, PnL $${unrealizedPnl.toFixed(2)})`);
          await this.orchestrator.closePosition(pos.id);
        }
      }

      if (updates.length > 0) {
        this.onPositionUpdate?.(updates);
      }
    } catch (err: any) {
      console.error('[Monitor] Error:', err.message);
    }
  }
}
