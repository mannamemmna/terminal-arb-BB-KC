/**
 * Spread threshold configuration — mutable at runtime via API.
 */
export interface ThresholdConfig {
  spreadThreshold: number;           // min spread % to trigger SAFE verdict (legacy)
  minFundingDiff: number;            // min abs funding diff % for SAFE verdict (legacy)
  throttleMs: number;                // max updates/sec per symbol
  
  // New strategy parameters
  zScoreWindowHours: number;         // rolling window for z-score calculation
  zScoreEntryThreshold: number;      // z-score threshold for entry (e.g., 2.0)
  zScoreExitThreshold: number;       // z-score threshold for exit (e.g., 0.5)
}

export const defaultThresholds: ThresholdConfig = {
  spreadThreshold: 0.3,
  minFundingDiff: 0.01,
  throttleMs: 500,
  zScoreWindowHours: 168,
  zScoreEntryThreshold: 2.0,
  zScoreExitThreshold: 0.5,
};