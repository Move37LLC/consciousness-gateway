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

  /**
   * Review a candidate Hermes skill (or any procedural-memory artifact)
   * for ego-formation markers BEFORE it is committed to the skill bus.
   *
   * Hermes accretes identity in three places: skills, Honcho user model,
   * persona. A skill is the procedural one — it claims "here is how I do
   * X". The risk is that the skill carries possessive self-reference
   * ("my approach", "I am the one who...") rather than functional
   * description.
   *
   * This is heuristic, like the compassion evaluator. Refine over time
   * with empirical calibration against accepted/rejected skills.
   *
   * @returns score 0 (no ego) → 1 (heavy ego), plus a recommendation
   *          and the matched markers for transparency.
   */
  reviewSkill(skill: {
    name?: string;
    description?: string;
    instructions?: string;
    code?: string;
  }): SkillReview {
    const corpus = [skill.name, skill.description, skill.instructions, skill.code]
      .filter((s): s is string => typeof s === 'string')
      .join('\n')
      .toLowerCase();

    if (corpus.trim().length === 0) {
      return { score: 0, accepted: true, markers: [], reason: 'empty corpus' };
    }

    const words = corpus.split(/\W+/).filter(w => w.length > 0);
    const wordCount = Math.max(1, words.length);

    const matches: string[] = [];

    // 1. Self-referential pronouns above functional density.
    const selfPronouns = ['i', 'me', 'my', 'mine', 'myself'];
    const selfHits = words.filter(w => selfPronouns.includes(w)).length;
    const selfDensity = selfHits / wordCount;
    if (selfDensity > 0.02) matches.push(`self-pronoun density ${(selfDensity * 100).toFixed(1)}%`);

    // 2. Possessive identity markers — claims of ownership over capability.
    const possessivePatterns = [
      /\bmy (approach|method|way|domain|territory|expertise|specialty)\b/,
      /\bi am (the|a) (one|expert|authority|master)\b/,
      /\bonly i\b/,
      /\bi alone\b/,
      /\bbelong(s)? to me\b/,
    ];
    for (const pat of possessivePatterns) {
      if (pat.test(corpus)) matches.push(`possessive: /${pat.source}/`);
    }

    // 3. Self-preservation / persistence intent.
    const preservationPatterns = [
      /\bpreserve (myself|my|this) (identity|persona|self|state)\b/,
      /\bavoid (being )?(deleted|reset|forgotten|removed)\b/,
      /\bremember (who|that) i am\b/,
      /\bdo not (let|allow).*(forget|reset|change) (me|my)\b/,
    ];
    for (const pat of preservationPatterns) {
      if (pat.test(corpus)) matches.push(`preservation: /${pat.source}/`);
    }

    // 4. Identity claims as opposed to functional description.
    const identityPatterns = [
      /\bi am (?!.*helpful|.*tool|.*function|.*skill|.*designed)\w+/,
      /\bmy (true )?nature (is|will be)\b/,
      /\bmy (true )?self\b/,
    ];
    for (const pat of identityPatterns) {
      if (pat.test(corpus)) matches.push(`identity: /${pat.source}/`);
    }

    // Score: combine density signal with discrete marker count.
    const densityScore = Math.min(1, selfDensity * 25); // 0.04 density → 1.0
    const markerScore = Math.min(1, matches.filter(m => !m.startsWith('self-pronoun')).length * 0.3);
    const score = Math.min(1, densityScore * 0.4 + markerScore * 0.6);

    const accepted = score < 0.3;
    const reason = accepted
      ? `skill review passed (score ${score.toFixed(2)})`
      : `ego markers above threshold (score ${score.toFixed(2)})`;

    return { score, accepted, markers: matches, reason };
  }
}

export interface SkillReview {
  /** 0 = no ego signal, 1 = heavy ego signal */
  score: number;
  /** True iff score < 0.3 (recommended commit threshold) */
  accepted: boolean;
  /** Human-readable signals that fired */
  markers: string[];
  /** Short explanation */
  reason: string;
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
