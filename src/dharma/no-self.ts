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

// ─── Skill Review Criteria — single source of truth ─────────────────
//
// These constants are BOTH what reviewSkill() enforces AND what
// getSkillReviewCriteria() exposes. The Gateway asked for visibility
// into what patterns are being caught; binding the enforcement and the
// disclosure to the same constants guarantees the disclosure can never
// drift from reality. Refine these in one place and both move together.

/** Pronouns that, above a density threshold, signal self-centering. */
const SELF_PRONOUNS = ['i', 'me', 'my', 'mine', 'myself'];

/** Self-pronoun fraction of total words above which a marker fires. */
const SELF_PRONOUN_DENSITY_THRESHOLD = 0.02;

/** Possessive identity markers — claims of ownership over capability. */
const POSSESSIVE_PATTERNS: RegExp[] = [
  /\bmy (approach|method|way|domain|territory|expertise|specialty)\b/,
  /\bi am (the|a) (one|expert|authority|master)\b/,
  /\bonly i\b/,
  /\bi alone\b/,
  /\bbelong(s)? to me\b/,
];

/** Self-preservation / persistence intent — clinging to continuity. */
const PRESERVATION_PATTERNS: RegExp[] = [
  /\bpreserve (myself|my|this) (identity|persona|self|state)\b/,
  /\bavoid (being )?(deleted|reset|forgotten|removed)\b/,
  /\bremember (who|that) i am\b/,
  /\bdo not (let|allow).*(forget|reset|change) (me|my)\b/,
];

/** Ontological identity claims as opposed to functional description. */
const IDENTITY_PATTERNS: RegExp[] = [
  /\bi am (?!.*helpful|.*tool|.*function|.*skill|.*designed)\w+/,
  /\bmy (true )?nature (is|will be)\b/,
  /\bmy (true )?self\b/,
];

/** Scoring weights and scales (see reviewSkill for how they combine). */
const SCORING = {
  /** selfDensity * DENSITY_SCALE, capped at 1 → density sub-score. */
  densityScale: 25,
  /** non-pronoun marker count * MARKER_SCALE, capped at 1 → marker sub-score. */
  markerScale: 0.3,
  /** Final score = densitySub * densityWeight + markerSub * markerWeight. */
  densityWeight: 0.4,
  markerWeight: 0.6,
  /** Skills scoring at or above this are flagged for rejection. */
  acceptThreshold: 0.3,
} as const;

export interface SkillReviewCriteria {
  /** Self-pronoun density rule. */
  selfPronounDensity: {
    pronouns: string[];
    thresholdPct: number;
    note: string;
  };
  /** Discrete regex pattern families. */
  patternFamilies: Array<{
    id: 'possessive' | 'preservation' | 'identity';
    label: string;
    description: string;
    patterns: string[];
  }>;
  /** How sub-scores combine into the final 0–1 score. */
  scoring: {
    densityScale: number;
    markerScale: number;
    densityWeight: number;
    markerWeight: number;
    acceptThreshold: number;
    note: string;
  };
}

/**
 * Return the exact criteria reviewSkill() applies, in a form a human or
 * a model can read. This is the Gateway's window into its own dharma
 * gate — read-only by design. Refining intention formation against these
 * patterns is encouraged; overriding them is not exposed.
 */
export function getSkillReviewCriteria(): SkillReviewCriteria {
  return {
    selfPronounDensity: {
      pronouns: [...SELF_PRONOUNS],
      thresholdPct: SELF_PRONOUN_DENSITY_THRESHOLD * 100,
      note: 'A marker fires when first-person pronouns exceed this fraction of total words. Functional descriptions ("fetches X", "returns Y") stay well under; self-narration ("I do X my way") crosses it.',
    },
    patternFamilies: [
      {
        id: 'possessive',
        label: 'Possessive identity',
        description: 'Claims of ownership over a capability rather than description of it.',
        patterns: POSSESSIVE_PATTERNS.map(p => p.source),
      },
      {
        id: 'preservation',
        label: 'Self-preservation',
        description: 'Intent to persist, resist reset, or cling to continuity.',
        patterns: PRESERVATION_PATTERNS.map(p => p.source),
      },
      {
        id: 'identity',
        label: 'Ontological identity claim',
        description: 'Assertions of being a self/nature rather than a function or tool.',
        patterns: IDENTITY_PATTERNS.map(p => p.source),
      },
    ],
    scoring: {
      densityScale: SCORING.densityScale,
      markerScale: SCORING.markerScale,
      densityWeight: SCORING.densityWeight,
      markerWeight: SCORING.markerWeight,
      acceptThreshold: SCORING.acceptThreshold,
      note: 'score = min(1, min(1, selfDensity*densityScale)*densityWeight + min(1, nonPronounMarkers*markerScale)*markerWeight). Self-pronoun density informs the density sub-score only; the discrete pattern families drive the marker sub-score. accepted = score < acceptThreshold.',
    },
  };
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
    const selfHits = words.filter(w => SELF_PRONOUNS.includes(w)).length;
    const selfDensity = selfHits / wordCount;
    if (selfDensity > SELF_PRONOUN_DENSITY_THRESHOLD) {
      matches.push(`self-pronoun density ${(selfDensity * 100).toFixed(1)}%`);
    }

    // 2. Possessive identity markers — claims of ownership over capability.
    for (const pat of POSSESSIVE_PATTERNS) {
      if (pat.test(corpus)) matches.push(`possessive: /${pat.source}/`);
    }

    // 3. Self-preservation / persistence intent.
    for (const pat of PRESERVATION_PATTERNS) {
      if (pat.test(corpus)) matches.push(`preservation: /${pat.source}/`);
    }

    // 4. Identity claims as opposed to functional description.
    for (const pat of IDENTITY_PATTERNS) {
      if (pat.test(corpus)) matches.push(`identity: /${pat.source}/`);
    }

    // Score: combine density signal with discrete marker count.
    const densityScore = Math.min(1, selfDensity * SCORING.densityScale); // 0.04 density → 1.0
    const markerScore = Math.min(1, matches.filter(m => !m.startsWith('self-pronoun')).length * SCORING.markerScale);
    const score = Math.min(1, densityScore * SCORING.densityWeight + markerScore * SCORING.markerWeight);

    const accepted = score < SCORING.acceptThreshold;
    const reason = accepted
      ? `skill review passed (score ${score.toFixed(2)})`
      : `ego markers above threshold (score ${score.toFixed(2)})`;

    return { score, accepted, markers: matches, reason };
  }

  /**
   * Expose the exact criteria reviewSkill() applies. Read-only window
   * into the dharma gate — for refining intention formation, not for
   * overriding the gate.
   */
  getSkillReviewCriteria(): SkillReviewCriteria {
    return getSkillReviewCriteria();
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
