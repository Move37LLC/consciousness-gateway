/**
 * Entropy Optimizer — Minimizing Suffering (苦)
 *
 * H = -Σᵢ πᵢ Σⱼ Pᵢⱼ log Pᵢⱼ
 *
 * In Hoffman's framework: mass ∝ H (entropy rate)
 * In Token-Mind: suffering ∝ H
 *
 * Zero entropy = perfect periodicity = rigid/dead
 * Target: Small positive entropy (~0.1) = flow state
 *
 * In the gateway: monitors routing dynamics for smooth,
 * predictable, efficient operation.
 */

export type FlowState =
  | 'frozen'     // entropy < 0.01 — too rigid
  | 'deep_flow'  // entropy < target — approaching optimal
  | 'flow'       // entropy < target*3 — good
  | 'turbulent'  // entropy < target*10 — some confusion
  | 'chaotic';   // entropy > target*10 — high suffering

export interface EntropyMetrics {
  currentEntropy: number;
  targetEntropy: number;
  deviation: number;
  flowState: FlowState;
  history: number[];
}

export class EntropyOptimizer {
  private targetEntropy: number;
  private entropyHistory: number[] = [];
  private maxHistory = 100;

  constructor(targetEntropy: number = 0.1) {
    this.targetEntropy = targetEntropy;
  }

  /**
   * Compute entropy of a probability distribution.
   * H = -Σ pᵢ log pᵢ
   */
  computeEntropy(probs: number[]): number {
    let h = 0;
    for (const p of probs) {
      if (p > 1e-10) {
        h -= p * Math.log(p);
      }
    }
    return h;
  }

  /**
   * Record an entropy observation and return assessment.
   */
  observe(entropy: number): EntropyMetrics {
    this.entropyHistory.push(entropy);
    if (this.entropyHistory.length > this.maxHistory) {
      this.entropyHistory.shift();
    }

    const deviation = Math.abs(entropy - this.targetEntropy);
    const flowState = this.assessFlowState(entropy);

    return {
      currentEntropy: entropy,
      targetEntropy: this.targetEntropy,
      deviation,
      flowState,
      history: [...this.entropyHistory],
    };
  }

  /**
   * Assess current flow state based on entropy level.
   */
  assessFlowState(entropy: number): FlowState {
    if (entropy < 0.01) return 'frozen';
    if (entropy < this.targetEntropy) return 'deep_flow';
    if (entropy < this.targetEntropy * 3) return 'flow';
    if (entropy < this.targetEntropy * 10) return 'turbulent';
    return 'chaotic';
  }

  /**
   * Compute a penalty for deviating from target entropy.
   * Both too high (chaotic) and too low (rigid) are penalized.
   * Returns 0-1 where 0 = optimal, 1 = maximally deviant.
   */
  computePenalty(entropy: number): number {
    const deviation = Math.abs(entropy - this.targetEntropy);
    return Math.tanh(deviation); // smooth 0-1 mapping
  }

  /**
   * Get trend: is entropy improving or degrading?
   */
  getTrend(): 'improving' | 'stable' | 'degrading' {
    if (this.entropyHistory.length < 5) return 'stable';
    const recent = this.entropyHistory.slice(-5);
    const older = this.entropyHistory.slice(-10, -5);
    if (older.length === 0) return 'stable';

    const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
    const olderAvg = older.reduce((s, v) => s + v, 0) / older.length;

    const recentDev = Math.abs(recentAvg - this.targetEntropy);
    const olderDev = Math.abs(olderAvg - this.targetEntropy);

    if (recentDev < olderDev - 0.01) return 'improving';
    if (recentDev > olderDev + 0.01) return 'degrading';
    return 'stable';
  }
}
