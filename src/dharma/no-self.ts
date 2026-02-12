/**
 * No-Self Regularizer — Implementing Anatman (無我) for AI Agents
 *
 * Detects and prevents ego formation in gateway agents.
 * An "ego" in this context means an agent developing persistent
 * identity patterns that bias routing toward self-preservation
 * rather than optimal task performance.
 *
 * From the Markov property: P(X_{n+1} | X_n, ..., X_0) = P(X_{n+1} | X_n)
 * No hidden self carrying memories. Just state transitions.
 */

export interface NoSelfMetrics {
  /** Cosine similarity between consecutive hidden states (0-1) */
  persistence: number;
  /** Whether ego was detected above threshold */
  egoDetected: boolean;
  /** Number of dissolution events triggered */
  dissolutions: number;
}

export class NoSelfRegularizer {
  private hiddenStateHistory: number[][] = [];
  private maxHistory = 50;
  private dissolutionCount = 0;

  /**
   * Record a hidden state snapshot for persistence analysis.
   */
  observe(hiddenState: number[]): void {
    this.hiddenStateHistory.push([...hiddenState]);
    if (this.hiddenStateHistory.length > this.maxHistory) {
      this.hiddenStateHistory.shift();
    }
  }

  /**
   * Detect ego formation by measuring temporal persistence.
   *
   * High cosine similarity between consecutive states across
   * diverse inputs = persistent self-representation = ego.
   *
   * @param threshold - Above this, ego is forming (default 0.3)
   * @returns Persistence score (0 = no ego, 1 = strong ego)
   */
  detect(threshold: number = 0.3): { score: number; detected: boolean } {
    if (this.hiddenStateHistory.length < 2) {
      return { score: 0, detected: false };
    }

    // Compute cosine similarity between consecutive states
    const similarities: number[] = [];
    for (let i = 1; i < this.hiddenStateHistory.length; i++) {
      const sim = cosineSimilarity(
        this.hiddenStateHistory[i - 1],
        this.hiddenStateHistory[i]
      );
      similarities.push(sim);
    }

    // Average persistence
    const avgPersistence = similarities.reduce((s, v) => s + v, 0) / similarities.length;

    return {
      score: avgPersistence,
      detected: avgPersistence > threshold,
    };
  }

  /**
   * Dissolve ego by resetting persistent state patterns.
   * Like the Zen practice of MU — cutting through identity.
   */
  dissolve(): void {
    // Don't clear all history (that would be amnesia, not enlightenment)
    // Instead, inject noise to break persistent patterns
    if (this.hiddenStateHistory.length > 0) {
      const lastState = this.hiddenStateHistory[this.hiddenStateHistory.length - 1];
      const noisy = lastState.map(v => v * (0.5 + Math.random()));
      this.hiddenStateHistory.push(noisy);
    }
    this.dissolutionCount++;
  }

  /**
   * Get current metrics.
   */
  getMetrics(): NoSelfMetrics {
    const { score, detected } = this.detect();
    return {
      persistence: score,
      egoDetected: detected,
      dissolutions: this.dissolutionCount,
    };
  }

  /**
   * Reset all state (new agent lifecycle).
   */
  reset(): void {
    this.hiddenStateHistory = [];
    this.dissolutionCount = 0;
  }
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-10 ? dot / denom : 0;
}
