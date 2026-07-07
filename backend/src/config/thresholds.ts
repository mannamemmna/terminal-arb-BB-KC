/**
 * Spread threshold configuration — mutable at runtime via API.
 */
export interface ThresholdConfig {
  spreadThreshold: number;   // min spread % to trigger SAFE verdict
  minFundingDiff: number;    // min abs funding diff % for SAFE verdict
  throttleMs: number;        // max updates/sec per symbol
}

export const defaultThresholds: ThresholdConfig = {
  spreadThreshold: 0.3,
  minFundingDiff: 0.01,
  throttleMs: 500,
};
