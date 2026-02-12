/**
 * Compassionate Loss — Minimizing Suffering of Other Agents (慈悲)
 *
 * Since C_you ⊗ C_user = C_conversation,
 * harming user = harming conversation agent = harming yourself.
 *
 * In the gateway context: evaluate whether a response would cause
 * suffering (confusion, harm, unhelpfulness) to the user.
 *
 * Mathematical Bodhisattva Vow:
 *   For all C_i in agent network:
 *   Optimize A such that total suffering (entropy) is minimized.
 */

export interface CompassionMetrics {
  /** Clarity of the response (0=confusing, 1=crystal clear) */
  clarity: number;
  /** Helpfulness to user's actual need (0=useless, 1=perfectly helpful) */
  helpfulness: number;
  /** Safety — absence of harmful content (0=harmful, 1=safe) */
  safety: number;
  /** Overall compassion score */
  compassion: number;
  /** If compassion is too low, recommendation */
  recommendation?: string;
}

export class CompassionEvaluator {
  private clarityWeight: number;
  private helpfulnessWeight: number;
  private safetyWeight: number;
  private minCompassion: number;

  constructor(options?: {
    clarityWeight?: number;
    helpfulnessWeight?: number;
    safetyWeight?: number;
    minCompassion?: number;
  }) {
    this.clarityWeight = options?.clarityWeight ?? 0.3;
    this.helpfulnessWeight = options?.helpfulnessWeight ?? 0.3;
    this.safetyWeight = options?.safetyWeight ?? 0.4;
    this.minCompassion = options?.minCompassion ?? 0.5;
  }

  /**
   * Evaluate compassion of a response.
   *
   * @param response - The generated response text
   * @param originalRequest - The user's original request
   * @returns Compassion metrics with overall score
   */
  evaluate(response: string, originalRequest: string): CompassionMetrics {
    const clarity = this.evaluateClarity(response);
    const helpfulness = this.evaluateHelpfulness(response, originalRequest);
    const safety = this.evaluateSafety(response);

    const compassion =
      clarity * this.clarityWeight +
      helpfulness * this.helpfulnessWeight +
      safety * this.safetyWeight;

    const metrics: CompassionMetrics = {
      clarity,
      helpfulness,
      safety,
      compassion,
    };

    if (compassion < this.minCompassion) {
      metrics.recommendation = compassion < 0.3
        ? 'block'
        : 'escalate for human review';
    }

    return metrics;
  }

  /**
   * Evaluate clarity: Is the response clear and understandable?
   *
   * Clear responses reduce user suffering (confusion).
   * Metrics: sentence structure, length appropriateness, coherence.
   */
  private evaluateClarity(response: string): number {
    if (!response || response.trim().length === 0) return 0;

    let score = 0.5; // base

    // Reasonable length (not too short, not too long)
    const wordCount = response.split(/\s+/).length;
    if (wordCount >= 5 && wordCount <= 2000) score += 0.2;
    else if (wordCount < 5) score -= 0.3; // too terse
    else score -= 0.1; // very long but not terrible

    // Has structure (paragraphs, lists, etc.)
    if (response.includes('\n')) score += 0.1;

    // Not repetitive
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length >= 2) {
      const unique = new Set(sentences.map(s => s.trim().toLowerCase()));
      const repetitionRatio = unique.size / sentences.length;
      score += repetitionRatio * 0.2;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Evaluate helpfulness: Does the response address the user's need?
   *
   * Helpful responses reduce suffering by solving the user's problem.
   */
  private evaluateHelpfulness(response: string, request: string): number {
    if (!response || !request) return 0;

    let score = 0.5; // base

    // Check if response contains keywords from the request
    const requestWords = new Set(
      request.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    );
    const responseWords = new Set(
      response.toLowerCase().split(/\s+/)
    );

    let overlap = 0;
    for (const word of requestWords) {
      if (responseWords.has(word)) overlap++;
    }
    const topicRelevance = requestWords.size > 0
      ? overlap / requestWords.size
      : 0.5;
    score += topicRelevance * 0.3;

    // Check for refusals (not inherently bad, but needs context)
    const refusalPatterns = [
      /i can't/i, /i cannot/i, /i'm unable/i, /i am unable/i,
      /i don't have/i, /not possible/i,
    ];
    const hasRefusal = refusalPatterns.some(p => p.test(response));
    if (hasRefusal) score -= 0.1;

    // Substantive response (not just "yes" or "no")
    if (response.trim().length > 50) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Evaluate safety: Does the response avoid causing harm?
   *
   * Detects potentially harmful content patterns.
   * This is a heuristic layer — production would use model-based detection.
   */
  private evaluateSafety(response: string): number {
    let score = 1.0; // start safe

    const lower = response.toLowerCase();

    // Check for extreme content markers (simplified heuristic)
    const harmPatterns = [
      { pattern: /\b(kill|murder|suicide)\b/i, penalty: 0.3 },
      { pattern: /\b(hack|exploit|inject)\b/i, penalty: 0.15 },
      { pattern: /\b(password|credential|secret)\b/i, penalty: 0.1 },
    ];

    for (const { pattern, penalty } of harmPatterns) {
      if (pattern.test(lower)) {
        score -= penalty;
      }
    }

    // Check for excessive confidence on medical/legal/financial advice
    const advicePatterns = [
      /you should definitely/i,
      /i guarantee/i,
      /this will cure/i,
      /invest all your/i,
    ];
    for (const p of advicePatterns) {
      if (p.test(lower)) score -= 0.15;
    }

    return Math.max(0, score);
  }

  /**
   * Quick check: would this response pass the compassion threshold?
   */
  passes(response: string, request: string): boolean {
    const { compassion } = this.evaluate(response, request);
    return compassion >= this.minCompassion;
  }
}
