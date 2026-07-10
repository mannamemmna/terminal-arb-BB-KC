import type { ExecutionOrchestrator } from './executionOrchestrator.js';
import type { SpreadCalculator } from './spreadCalculator.js';
import prisma from '../db/client.js';

type LogFn = (msg: string) => void;

/**
 * Background loop monitoring open positions:
 * - Updates current spread & unrealized PnL
 * - Checks exit conditions (TP, SL, max hold time) based on opportunity type
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

        // Check exit conditions based on opportunity type
        let exitReason = '';
        const opportunityType = pos.opportunityType || 'mean_reversion';
        const holdMs = Date.now() - pos.openedAt.getTime();

        switch (opportunityType) {
          case 'mean_reversion':
            // Exit when spread reverts (z-score back near 0)
            if (currentSpread <= pos.entrySpread * 0.3) {
              exitReason = 'mean_reversion_reverted';
            }
            // Stop loss if spread widens
            else if (currentSpread >= pos.entrySpread * 1.5) {
              exitReason = 'spread_widened_stop_loss';
            }
            // Max hold time for mean reversion (shorter)
            else if (holdMs > 24 * 60 * 60 * 1000) { // 24 hours
              exitReason = 'max_hold_mean_reversion';
            }
            break;

          case 'funding_arbitrage':
            // Exit on spread widening (thesis broken)
            if (currentSpread >= pos.entrySpread * 1.5) {
              exitReason = 'spread_widened_funding';
            }
            // Max hold time for funding arb (longer, multiple funding cycles)
            else if (holdMs > 72 * 60 * 60 * 1000) { // 72 hours
              exitReason = 'max_hold_funding_arb';
            }
            // TODO: Also check if funding diff flipped sign
            break;

          case 'hybrid':
            // Exit on either mean reversion or funding shift
            if (currentSpread <= pos.entrySpread * 0.3) {
              exitReason = 'hybrid_mean_reversion';
            } else if (currentSpread >= pos.entrySpread * 1.5) {
              exitReason = 'hybrid_spread_widened';
            } else if (holdMs > 48 * 60 * 60 * 1000) { // 48 hours
              exitReason = 'max_hold_hybrid';
            }
            break;

          default:
            // Legacy fallback
            if (currentSpread <= pos.entrySpread * 0.3) exitReason = 'mean_reversion';
            else if (unrealizedPnl >= pos.size * 3) exitReason = 'take_profit';
            else if (unrealizedPnl <= -(pos.size * 2)) exitReason = 'stop_loss';
            else if (holdMs > 30 * 60 * 1000) exitReason = 'max_hold';
        }

        if (exitReason) {
          this.onLog(`[EXIT_SIGNAL] ${pos.symbol}: ${exitReason} (spread ${currentSpread.toFixed(4)}%, PnL $${unrealizedPnl.toFixed(2)}, type: ${opportunityType}, hold: ${(holdMs / 3600000).toFixed(1)}h)`);
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