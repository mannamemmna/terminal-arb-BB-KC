type LogFn = (msg: string) => void;

export type KillSwitchState = 'ACTIVE' | 'PAUSED' | 'TRIGGERED';

/**
 * Global safety kill-switch.
 * - PAUSED: stops new entries, active positions still monitored
 * - TRIGGERED: force-close all positions immediately
 * - ACTIVE: normal operation
 */
export class KillSwitch {
  private state: KillSwitchState = 'ACTIVE';
  private closeAllFn: (() => Promise<void>) | null = null;
  private onLog: LogFn;

  constructor(onLog: LogFn) {
    this.onLog = onLog;
  }

  setCloseAll(fn: () => Promise<void>): void {
    this.closeAllFn = fn;
  }

  getState(): KillSwitchState { return this.state; }

  async pause(): Promise<void> {
    this.state = 'PAUSED';
    this.onLog('[KILL] Entry paused — active positions still running');
  }

  async resume(): Promise<void> {
    this.state = 'ACTIVE';
    this.onLog('[KILL] Resume — entries allowed');
  }

  async trigger(): Promise<void> {
    this.state = 'TRIGGERED';
    this.onLog('[KILL] EMERGENCY — closing all positions');
    if (this.closeAllFn) {
      await this.closeAllFn();
    }
    this.state = 'ACTIVE';
  }

  get isPaused(): boolean { return this.state === 'PAUSED'; }
  get isTriggered(): boolean { return this.state === 'TRIGGERED'; }
  get isActive(): boolean { return this.state === 'ACTIVE'; }
}
